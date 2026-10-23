import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "./http.ts";
import type { HttpFetch } from "./providers/types.ts";

// 开发版调试日志：每条一行 JSON，写到项目的 .debug/network.jsonl（由 Rust 的 debug_log 命令写入）。
// 只在「开发环境 + 桌面应用」启用；发布版中 DEBUG_LOG 为常量 false，下面的记录代码不会执行。
// 密钥只保留首尾几位；请求与响应内容完整记录，便于对照提示词和模型原始输出。

export const DEBUG_LOG = import.meta.env.DEV && IN_APP;

const MAX_BODY = 200_000;

export function debugLog(entry: Record<string, unknown>) {
  if (!DEBUG_LOG) return;
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
  invoke("debug_log", { line }).catch((err) => console.warn("debug log write failed", err));
}

// 长密钥保留首 6 位与末 4 位；过短的整体隐去
const maskKey = (v: string) => v.replace(/(Bearer\s+)(\S+)/i, (_, p: string, k: string) => p + (k.length > 14 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "***"));

function headersOf(init: RequestInit) {
  const out: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { out[k] = k.toLowerCase() === "authorization" ? maskKey(v) : v; });
  return out;
}

const parse = (text: string) => {
  try { return JSON.parse(text); } catch { return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…(截断)" : text; }
};

/** 流式响应：除原始 SSE 文本外，拼出模型实际输出的正文与思考内容 */
function summarizeSSE(text: string) {
  let content = "", reasoning = "", chunks = 0;
  let usage: unknown;
  for (const line of text.split("\n")) {
    const data = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      chunks++;
      content += j.choices?.[0]?.delta?.content ?? "";
      reasoning += j.choices?.[0]?.delta?.reasoning_content ?? "";
      if (j.usage) usage = j.usage;
    } catch { /* 原始文本里保留 */ }
  }
  return { chunks, content, reasoning: reasoning || undefined, usage, raw: text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…(截断)" : text };
}

// 图片的 base64 动辄几百 KB，日志里只留类型与长度
const shrinkImages = (body: string) => body.replace(/data:(image\/[\w.+-]+);base64,[A-Za-z0-9+/=]+/g, (m, type: string) => `data:${type};base64,…(${m.length} 字符)`);

let seq = 0;

/** 包一层 fetch：记录请求、首包耗时、完整响应；不改变返回给调用方的 Response */
export function tracedFetch(base: HttpFetch, run: string): HttpFetch {
  if (!DEBUG_LOG) return base;
  return async (url, init) => {
    const req = `${run}.${++seq}`;
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    debugLog({ run, req, type: "http.request", method: init.method ?? "GET", url, headers: headersOf(init), body: typeof init.body === "string" ? parse(shrinkImages(init.body)) : undefined });
    let res: Response;
    try {
      res = await base(url, init);
    } catch (err) {
      debugLog({ run, req, type: "http.error", ms: ms(), error: String(err), aborted: !!init.signal?.aborted });
      throw err;
    }
    const firstByteMs = ms();
    const copy = res.clone();
    const sse = (res.headers.get("content-type") ?? "").includes("event-stream");
    copy.text().then(
      (text) => debugLog({ run, req, type: "http.response", status: res.status, firstByteMs, totalMs: ms(), contentType: res.headers.get("content-type"), body: sse ? summarizeSSE(text) : parse(text) }),
      (err) => debugLog({ run, req, type: "http.response", status: res.status, firstByteMs, totalMs: ms(), bodyError: String(err), aborted: !!init.signal?.aborted }),
    );
    return res;
  };
}
