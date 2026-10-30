import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { isPackName, PACK_FORMAT, PACK_VERSION, requestKey, type Pack, type PackCall } from "./src/core/pack.ts";

// 痕迹AI 的录制探针包尚未发布到 npm，暂时直接引用本机痕迹仓库里的源码（tsconfig.json 的 paths 同步）；发布后改为 npm 依赖并删掉这里
const probeDir = fileURLToPath(new URL("../Henji-AI/packages/web-replay-probe/src", import.meta.url));

/** 演示用数据包（src/core/pack.ts）的目录：不入库的 .env.local 里的 ZDS_PACK_DIR，没设时为项目里不入库的 .packs/ */
const root = fileURLToPath(new URL(".", import.meta.url));
const PACK_DIR = resolve(root, loadEnv("development", root, "ZDS_").ZDS_PACK_DIR || ".packs");

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
 * - POST /__zds/net：替页面转发外部请求（腾讯接口不允许浏览器跨域），响应边收边转，流式输出照样是流；
 * - GET /__zds/pack/名字：读数据包文件；POST /__zds/pack/名字?session=…：采集时每结束一次调用发来这一次，并进数据包文件。
 * 只接受本页面自己发来的请求（Sec-Fetch-Site: same-origin），别的网页不能借它访问外网或写文件。
 */
function devNet(): Plugin {
  return {
    name: "zds-dev-net",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__zds/net", (req, res) => void forward(req, res).catch((err) => fail(res, err)));
      server.middlewares.use("/__zds/pack/", (req, res) => void packFile(req, res).catch((err) => fail(res, err)));
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

async function packFile(req: IncomingMessage, res: ServerResponse) {
  if (!sameOrigin(req)) return reply(res, 403);
  const name = decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0]);
  if (!isPackName(name)) return reply(res, 400, "数据包名不合法");
  const file = join(PACK_DIR, `${name}.json`);
  if (req.method === "GET") {
    try {
      const text = await readFile(file, "utf8");
      res.setHeader("content-type", "application/json; charset=utf-8");
      return reply(res, 200, text);
    } catch (err) {
      return reply(res, (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500, String(err));
    }
  }
  if (req.method === "POST") {
    let call: PackCall;
    try { call = JSON.parse(await readBody(req)); } catch { return reply(res, 400, "不是 JSON"); }
    const session = new URL(req.url ?? "", "http://x").searchParams.get("session") ?? "";
    const total = await mergeCall(file, name, session, call);
    res.setHeader("x-zds-calls", String(total));
    return reply(res, 204);
  }
  reply(res, 405);
}

/** 每个数据包文件的写入排成一队，同时结束的几次调用不会互相覆盖 */
const packQueues = new Map<string, Promise<unknown>>();
/** 每一页采集（session）的调用时刻要加多少，才排在它开始时数据包已有的调用之后 */
const sessionShift = new Map<string, number>();

/**
 * 把一次调用并进数据包文件：同名数据包已存在（页面刷新、热更新整页重载、接着上次采集）时接着记；
 * 同样的请求再发一次（重新回答、刷新后重问）只留最新这次，数据包不会越记越大，重放拿到的也是最新结果。
 * 要从头重采就先删掉文件或换个名字。返回并入后共有几次调用
 */
function mergeCall(file: string, name: string, session: string, call: PackCall) {
  const job = (packQueues.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let pack: Pack;
    try {
      pack = JSON.parse(await readFile(file, "utf8")) as Pack;
      if (pack.format !== PACK_FORMAT || pack.version > PACK_VERSION) throw new Error(`「${name}」不是这个版本能续写的数据包`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      pack = { format: PACK_FORMAT, version: PACK_VERSION, name, createdAt: new Date().toISOString(), calls: [] };
    }
    const key = `${file}
${session}`;
    if (!sessionShift.has(key)) sessionShift.set(key, pack.calls.length ? Math.max(...pack.calls.map((c) => c.at + (c.ms ?? c.errorMs ?? 0))) + 1000 : 0);
    const same = requestKey(call.method, call.url, call.body);
    pack.calls = pack.calls.filter((c) => requestKey(c.method, c.url, c.body) !== same);
    pack.calls.push({ ...call, at: call.at + sessionShift.get(key)! });
    await mkdir(PACK_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(pack), "utf8");
    return pack.calls.length;
  });
  packQueues.set(file, job);
  return job;
}
