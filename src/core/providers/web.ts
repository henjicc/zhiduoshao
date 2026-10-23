import { Readability } from "@mozilla/readability";
import type { HttpFetch } from "./types.ts";

// 网页全文读取：研究 Agent 觉得摘要不够时，按需抓取少数几篇来源网页并提取正文。
// 网址来自搜索结果而不是用户输入，所以只允许公网的 http/https；本机与内网地址一律拒绝（Tauri 作用域里也有同样的拒绝名单），
// 重定向逐跳检查；限制超时、大小与类型。

export interface PageText {
  title: string;
  text: string;
}

export interface PageReader {
  read(url: string, signal?: AbortSignal): Promise<PageText>;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** 提取后的正文最多保留多少字，避免单篇撑满提示词 */
export const MAX_PAGE_CHARS = 8000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class PageError extends Error {}

/** 只允许公网 http/https：拒绝本机、内网、链路本地、.local 等地址，防止网页内容诱导应用访问用户自己的设备或局域网 */
export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (h.includes(":")) {
    // IPv6：回环、未指定、唯一本地（fc00::/7）、链路本地（fe80::/10）、IPv4 映射
    if (h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:")) return false;
  }
  return true;
}

/** 网页编码：先看响应头，再看页面前部的 meta；中文站常见 GBK，按 UTF-8 解码会乱码 */
export function sniffCharset(contentType: string | null, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const cs = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  return cs === "gb2312" || cs === "gbk" ? "gb18030" : cs;
}

/** 正文整理：合并空白，保留段落分隔，截到上限 */
export function tidyText(text: string): string {
  const t = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return t.length > MAX_PAGE_CHARS ? t.slice(0, MAX_PAGE_CHARS) + "…" : t;
}

/** 从 HTML 提取标题与正文：Readability 识别正文区域；识别不出时退回整页可见文字 */
function extract(html: string, url: string): PageText {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Readability 需要文档的基础地址来处理相对链接；它会修改文档，所以先取好退回用的整页文字
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);
  for (const el of doc.querySelectorAll("script, style, noscript, template, svg, iframe")) el.remove();
  const fallback = doc.body?.textContent ?? "";
  const title = doc.title.trim();
  const article = new Readability(doc).parse();
  const text = tidyText(article?.textContent && article.textContent.trim().length > 200 ? article.textContent : fallback);
  return { title: article?.title?.trim() || title, text };
}

export function createPageReader(fetchFn: HttpFetch): PageReader {
  return {
    async read(url, signal) {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let current = url;
      let res: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!isPublicUrl(current)) throw new PageError("网址不是公网地址，已拒绝");
        // 不自动跟随重定向：每一跳都要重新检查地址
        const init = { method: "GET", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6" }, signal: sig, maxRedirections: 0, redirect: "manual" } as RequestInit;
        try {
          res = await fetchFn(current, init);
        } catch (err) {
          if (signal?.aborted) throw err;
          throw new PageError(timeout.aborted ? "网页超过 10 秒没有响应" : "无法连接该网页（可能拒绝了访问）");
        }
        const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!loc) break;
        current = new URL(loc, current).href;
        res = null;
      }
      if (!res) throw new PageError("重定向次数过多");
      if (!res.ok) throw new PageError(`网页返回 HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) throw new PageError(`不是网页（${type.split(";")[0]}）`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) throw new PageError("网页过大");
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new PageError("网页过大");
      const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
      let html: string;
      try {
        html = new TextDecoder(sniffCharset(type, head)).decode(buf);
      } catch {
        html = new TextDecoder("utf-8").decode(buf);
      }
      if (/text\/plain/i.test(type)) return { title: "", text: tidyText(html) };
      const page = extract(html, current);
      if (page.text.length < 80) throw new PageError("没有提取到正文（可能需要登录或由脚本渲染）");
      return page;
    },
  };
}
