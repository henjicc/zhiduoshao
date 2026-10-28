// 数据包：开发时把外部调用（TokenHub 模型、元宝搜索、读网页）的原始返回原样存下来（采集），
// 之后对同样的请求原样放回（重放），给演示录制用：画面里的回答来自真实请求，反复重录不再花钱、内容也不变。
// 这里只放格式与纯函数；浏览器里的采集、重放与开关见 devNet.ts。

export const PACK_FORMAT = "zds-pack";
export const PACK_VERSION = 1;

export interface PackResponse {
  status: number;
  headers: Record<string, string>;
  /** 收到响应头用了多久（毫秒，距请求发出） */
  firstByteMs: number;
  /** 流式输出与 JSON 按 UTF-8 文本存，便于查看；其他（网页可能是 GBK）每块按 base64 存 */
  encoding: "utf8" | "base64";
  /** [收到时距请求发出的毫秒数, 这一块的内容]，按到达顺序 */
  chunks: [number, string][];
}

export interface PackCall {
  /** 采集开始后第几毫秒发出 */
  at: number;
  method: string;
  url: string;
  /** 去掉密钥后的请求头 */
  headers: Record<string, string>;
  /** 请求体：JSON 解析后存（去掉密钥字段），不是 JSON 的原样存字符串 */
  body?: unknown;
  response?: PackResponse;
  /** 请求没送达或读到一半中断时的错误，重放时在同一时刻照样失败 */
  error?: string;
  /** 出错的时刻（毫秒，距请求发出） */
  errorMs?: number;
  /** 是调用方自己取消的（研究决策超时、读网页超时、用户取消）：重放时不自己结束，等调用方取消 */
  aborted?: boolean;
  /** 正常结束（响应读完）用了多久；既没有它也没有 error 的是采集中途停下、没录完的调用 */
  ms?: number;
}

export interface Pack {
  format: typeof PACK_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  calls: PackCall[];
}

/** 重放的节奏：默认照录下来的时间；speed、cps、thinkCps、firstMs 只改写答案这类正文流（见 schedule） */
export interface Pace {
  /** 正文流整体倍速 */
  speed: number;
  /** 正文每秒几字 */
  cps?: number;
  /** 思考每秒几字 */
  thinkCps?: number;
  /** 首包延迟（毫秒） */
  firstMs?: number;
}

export type PackMode = { kind: "capture"; name: string } | { kind: "replay"; name: string; pace: Pace };

/** 数据包名就是文件名：不能带路径分隔符、不能以点开头 */
export const isPackName = (s: string) => /^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,79}$/.test(s);

const num = (v: string | null, min: number) => {
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > min ? n : undefined;
};

/** 地址参数：?capture=名字 采集；?replay=名字 重放，可带 speed、cps、thinkCps、firstMs */
export function parsePackMode(search: string): PackMode | null {
  const q = new URLSearchParams(search);
  const capture = q.get("capture");
  const replay = q.get("replay");
  if (capture !== null && replay !== null) throw new Error("capture 与 replay 只能选一个");
  const name = capture ?? replay;
  if (name === null) return null;
  if (!isPackName(name)) throw new Error(`数据包名不合法：${name}`);
  if (capture !== null) return { kind: "capture", name };
  return { kind: "replay", name, pace: { speed: num(q.get("speed"), 0) ?? 1, cps: num(q.get("cps"), 0), thinkCps: num(q.get("thinkCps"), 0), firstMs: num(q.get("firstMs"), -1) } };
}

// ---- 密钥：请求头与请求体里按名字去掉，另外把请求里见过的密钥值在整个数据包里替换掉 ----

const SECRET_NAME = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|secret|token|access[-_]?token|key)$/i;

export function safeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((v, k) => { if (!SECRET_NAME.test(k)) out[k] = v; });
  return out;
}

export function stripSecretFields(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSecretFields);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_NAME.test(k)).map(([k, x]) => [k, stripSecretFields(x)]));
}

/** 请求里带的密钥值（Bearer 令牌等），保存前在整个数据包文本里替换掉 */
export function secretsOf(headers: HeadersInit | undefined): string[] {
  const out: string[] = [];
  new Headers(headers).forEach((v, k) => {
    if (!SECRET_NAME.test(k)) return;
    const token = v.replace(/^(Bearer|Basic|Token)\s+/i, "").trim();
    if (token.length >= 8) out.push(token);
  });
  return out;
}

export const scrubSecrets = (text: string, secrets: Iterable<string>) => {
  for (const s of secrets) text = text.split(s).join("***");
  return text;
};

/** 请求体按存进数据包的样子解析：JSON 解析并去掉密钥字段，不是 JSON 的原样保留 */
export function packBody(body: unknown): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") throw new Error("数据包只支持文本请求体");
  try { return stripSecretFields(JSON.parse(body)); } catch { return body; }
}

/**
 * 请求和数据包的对应关系：方法 + 网址 + 请求体。提示词里有当天日期（以及按今天算的时间范围），
 * 换一天重放也要对得上，所以比较时把 YYYY-MM-DD 都换成占位
 */
export function requestKey(method: string, url: string, body: unknown) {
  return `${method.toUpperCase()} ${url}\n${body === undefined ? "" : JSON.stringify(body)}`.replace(/\d{4}-\d{2}-\d{2}/g, "<日期>");
}

/** 对不上时给人看的差异：第一处不同的位置与前后一段 */
export function firstDifference(mine: string, theirs: string) {
  let i = 0;
  while (i < mine.length && i < theirs.length && mine[i] === theirs[i]) i++;
  const cut = (s: string) => s.slice(Math.max(0, i - 40), i + 80);
  return { at: i, mine: cut(mine), theirs: cut(theirs) };
}

// ---- 重放节奏 ----

/** 写答案、详解这类正文流（不是 JSON 模式的研究决策）：只有它们能改节奏 */
const isProse = (call: PackCall) => {
  const b = call.body as { stream?: unknown; response_format?: unknown } | undefined;
  return !!b && typeof b === "object" && b.stream === true && !b.response_format;
};

/** 把 SSE 文本按事件切开，每个事件带上它所在那块的到达时间；没切完的尾巴算在最后一块 */
function sseEvents(chunks: [number, string][]): [number, string][] {
  const out: [number, string][] = [];
  let buf = "";
  let last = 0;
  for (const [t, text] of chunks) {
    buf += text;
    last = t;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      out.push([t, buf.slice(0, i + 2)]);
      buf = buf.slice(i + 2);
    }
  }
  if (buf) out.push([last, buf]);
  return out;
}

/** 一个 SSE 事件里的思考与正文字数 */
function deltaChars(event: string) {
  let think = 0, text = 0;
  for (const line of event.split("\n")) {
    const data = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    try {
      const d = JSON.parse(data).choices?.[0]?.delta;
      think += typeof d?.reasoning_content === "string" ? d.reasoning_content.length : 0;
      text += typeof d?.content === "string" ? d.content.length : 0;
    } catch { /* 不是 JSON 的行不计字数 */ }
  }
  return { think, text };
}

/**
 * 一次调用的重放时间表（距请求发出的毫秒数）：响应头何时到、每块何时到、出错的调用何时失败。
 * 研究决策、搜索、读网页一律照录下来的时间：决策有 12 秒时限、研究整体有 45 秒预算，变快变慢都可能走上和采集时不同的路、请求对不上。
 * 正文流按录制时间除以 speed；设了 cps / thinkCps / firstMs 时，对应部分按字数重新排，其余部分仍照录制
 */
export function schedule(call: PackCall, pace: Pace): { headersAt: number; chunks: [number, string][]; failAt: number } {
  const r = call.response;
  const base = pace.speed > 0 ? pace.speed : 1;
  const prose = !!r && isProse(call) && (r.headers["content-type"] ?? "").includes("event-stream") && r.encoding === "utf8";
  const speed = prose ? base : 1;
  const failAt = (call.errorMs ?? 0) / speed;
  if (!r) return { headersAt: 0, chunks: [], failAt };
  if (!prose || (pace.cps === undefined && pace.thinkCps === undefined && pace.firstMs === undefined)) {
    return { headersAt: r.firstByteMs / speed, chunks: r.chunks.map(([t, c]) => [t / speed, c]), failAt };
  }
  const headersAt = pace.firstMs ?? r.firstByteMs / speed;
  let at = headersAt;
  let prev = r.firstByteMs;
  const chunks: [number, string][] = [];
  for (const [t, event] of sseEvents(r.chunks)) {
    const { think, text } = deltaChars(event);
    const recorded = Math.max(0, t - prev) / speed;
    at += think && pace.thinkCps ? (think * 1000) / pace.thinkCps : text && pace.cps ? (text * 1000) / pace.cps : recorded;
    prev = t;
    chunks.push([at, event]);
  }
  return { headersAt, chunks, failAt: Math.max(failAt, at) };
}
