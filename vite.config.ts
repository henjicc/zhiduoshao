import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 痕迹AI 的录制探针包尚未发布到 npm，暂时直接引用本机痕迹仓库里的源码（tsconfig.json 的 paths 同步）；发布后改为 npm 依赖并删掉这里
const probeDir = fileURLToPath(new URL("../Henji-AI/packages/web-replay-probe/src", import.meta.url));

// 同时服务于浏览器开发（示例模式）与 Tauri 桌面应用（tauri dev 会连接这个端口）
export default defineConfig({
  plugins: [react(), devNet()],
  clearScreen: false,
  resolve: { alias: { "@henjicc/web-replay-probe": `${probeDir}/index.ts` } },
  server: {
    port: 17531,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    fs: { allow: [".", probeDir] },
  },
  build: { target: "es2022" },
});

/**
 * 只在开发服务器上有、只给开发时的浏览器页面用（src/core/devNet.ts）：
 * POST /__zds/net 替页面转发外部请求（腾讯接口不允许浏览器跨域），响应边收边转，流式输出照样是流。
 * 只接受本页面自己发来的请求（Sec-Fetch-Site: same-origin），别的网页不能借它访问外网。
 */
function devNet(): Plugin {
  return {
    name: "zds-dev-net",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__zds/net", (req, res) => void forward(req, res).catch((err) => fail(res, err)));
    },
  };
}

const sameOrigin = (req: IncomingMessage) => req.headers["sec-fetch-site"] === "same-origin";

async function readBody(req: IncomingMessage) {
  const parts: Buffer[] = [];
  for await (const p of req) parts.push(p as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

const reply = (res: ServerResponse, status: number, text = "") => { res.statusCode = status; res.end(text); };

/** 处理出错：还没开始回复就回 500，正在转发的直接断开，页面那边按请求失败处理 */
function fail(res: ServerResponse, err: unknown) {
  console.error("[zds-dev-net]", err);
  if (res.headersSent) res.destroy();
  else reply(res, 500, String(err));
}

/** 不转回页面的响应头：上游已解压，长度与编码都不再对得上 */
const DROP = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|set-cookie)$/i;

async function forward(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" || !sameOrigin(req)) return reply(res, 403);
  const env = JSON.parse(await readBody(req)) as { url: string; method: string; headers: Record<string, string>; body?: string };
  if (!/^https?:\/\//i.test(env.url)) return reply(res, 400, "只转发 http / https");
  // 页面取消请求（或连接断开）时一起取消上游
  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  let up: Response;
  try {
    // 不自动跟随重定向：读网页全文要自己逐跳检查地址（src/core/providers/web.ts）
    up = await fetch(env.url, { method: env.method, headers: env.headers, body: env.body, redirect: "manual", signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) return;
    res.setHeader("x-zds-error", encodeURIComponent(String((err as Error).cause ?? err)));
    return reply(res, 502);
  }
  const headers: Record<string, string> = {};
  up.headers.forEach((v, k) => { if (!DROP.test(k)) headers[k] = v; });
  res.statusCode = 200;
  res.setHeader("x-zds-status", String(up.status));
  res.setHeader("x-zds-headers", encodeURIComponent(JSON.stringify(headers)));
  res.setHeader("content-type", up.headers.get("content-type") ?? "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  res.flushHeaders();
  if (!up.body) return res.end();
  Readable.fromWeb(up.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
}
