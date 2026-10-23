import type { Source } from "../protocol.ts";
import { ProviderError, type HttpFetch, type SearchOptions, type SearchProvider } from "./types.ts";

// 腾讯云元宝搜索 SearchPro，服务 API KEY 方式
// 文档：https://cloud.tencent.com/document/product/1806/130615
// 参数：https://cloud.tencent.com/document/api/1806/121811
const ENDPOINT = "https://api.wsa.cloud.tencent.com/SearchPro";
const COUNTS = [10, 20, 30, 40, 50];
/** 响应里的 Version；极速版不支持 Cnt、Industry 等参数 */
export const VERSION_LABEL: Record<string, string> = { lite: "极速版", standard: "标准版", flagship: "旗舰版" };

export interface YuanbaoConfig {
  apiKey: string;
  fetch: HttpFetch;
  count?: number;
}

interface RawPage {
  title?: string;
  url?: string;
  passage?: string;
  content?: string;
  site?: string;
  favicon?: string;
  date?: string;
  authority_level?: number;
  pics?: { caption?: string; origin_url?: string }[];
  deeplinks?: { title?: string; url?: string }[];
  /** VR 卡：2026-10 实测（标准版、天气问题）为 vr: true、vr_category、vrid，带 url，摘要在 passage 里按「# 键：值」逐行排列，没有 content。
   * 文档没写这些字段，is_vr / type 按常见命名兼容 */
  vr?: unknown;
  vr_category?: unknown;
  is_vr?: unknown;
  type?: unknown;
}

/** VR 卡的摘要：去掉各种「跳转地址」行和行首的 #，留下给人和模型看的键值内容 */
export function cardText(raw: string) {
  return raw.split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trimEnd())
    .filter((l, i, all) => !/跳转地址/.test(l) && !(l === "" && all[i - 1] === ""))
    .join("\n").trim();
}

const MAX_PICS = 6;
const MAX_LINKS = 6;
const isWeb = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** 文档没有给出 VR 卡的返回结构：没有链接但有标题和摘要的条目、或带 vr 标记的条目都按权威卡片处理 */
const isCard = (p: RawPage) =>
  !p.url || p.vr === true || p.is_vr === true || p.is_vr === 1 || (typeof p.type === "string" && /vr/i.test(p.type));

export function parsePages(pages: string[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const raw of pages) {
    let p: RawPage;
    try {
      p = JSON.parse(raw);
    } catch {
      continue; // 单条结果损坏不影响其余结果
    }
    const title = p.title?.trim();
    const card = isCard(p);
    const text = (p.content || p.passage || "").trim();
    const snippet = card ? cardText(text) : text;
    const url = isWeb(p.url) ? p.url : "";
    if (!title || (!url && !snippet)) continue;
    const id = url || `card:${title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let site = p.site?.trim();
    if (!site && url) {
      try { site = new URL(url).hostname.replace(/^www\./, ""); } catch { site = ""; }
    }
    const pics = (Array.isArray(p.pics) ? p.pics : []).filter((x) => isWeb(x?.origin_url)).slice(0, MAX_PICS)
      .map((x) => ({ url: x.origin_url!, caption: (x.caption ?? "").trim() }));
    const links = (Array.isArray(p.deeplinks) ? p.deeplinks : []).filter((x) => isWeb(x?.url) && x.title?.trim()).slice(0, MAX_LINKS)
      .map((x) => ({ title: x.title!.trim(), url: x.url! }));
    out.push({
      id,
      title,
      url,
      site: site || "",
      favicon: isWeb(p.favicon) ? p.favicon : undefined,
      date: p.date || undefined,
      snippet,
      ...(card ? { card: true } : {}),
      ...(card && typeof p.vr_category === "string" && p.vr_category ? { cardType: p.vr_category } : {}),
      ...(typeof p.authority_level === "number" ? { authority: p.authority_level } : {}),
      ...(pics.length ? { pics } : {}),
      ...(links.length ? { links } : {}),
    });
  }
  return out;
}

/** 请求体：极速版只发它支持的参数，避免整次请求被拒；版本未知时按标准版处理 */
export function requestBody(query: string, opts: SearchOptions, count: number, version: string | null) {
  const body: Record<string, unknown> = { Query: query };
  if (opts.freshness) body.Freshness = opts.freshness;
  if (opts.site) body.Site = opts.site;
  if (version !== "lite") {
    body.Cnt = COUNTS.includes(opts.count ?? 0) ? opts.count : count;
    // 混合结果：自然结果 + 优质权威垂直信源（VR 卡）
    body.Mode = 2;
    if (opts.industry) body.Industry = opts.industry;
  }
  // 子链只有旗舰版支持，确认版本后才请求
  if (version === "flagship") body.Deeplinks = true;
  return body;
}

// 每次提问都会新建供应商，按密钥记住已知版本，后续请求直接按版本组织参数
const knownVersion = new Map<string, string>();

export interface YuanbaoProvider extends SearchProvider {
  /** 最近一次响应里的服务版本（lite / standard / flagship），尚未请求过时为 null */
  version(): string | null;
}

export function createYuanbao(cfg: YuanbaoConfig): YuanbaoProvider {
  const name = "yuanbao";
  const count = COUNTS.includes(cfg.count ?? 0) ? cfg.count! : 10;
  let version: string | null = knownVersion.get(cfg.apiKey) ?? null;
  return {
    name,
    version: () => version,
    async search(query, opts = {}) {
      let res: Response;
      try {
        res = await cfg.fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(requestBody(query, opts, count, version)),
          signal: opts.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        throw new ProviderError(name, "无法连接元宝搜索", String(err), "network", { hint: "请求没能送达元宝搜索（api.wsa.cloud.tencent.com），服务没有收到。常见原因是网络断开、代理或 VPN 拦截了连接、连接超时；检查网络后点重试。" });
      }
      const text = await res.text();
      let json: { Response?: { Pages?: string[]; Version?: string; Error?: { Code: string; Message: string }; RequestId?: string } } | null = null;
      try { json = JSON.parse(text); } catch { /* 下面按状态码处理 */ }
      const r = json?.Response;
      if (res.ok && r && !r.Error) {
        if (r.Version) knownVersion.set(cfg.apiKey, (version = r.Version));
        return parsePages(r.Pages ?? []);
      }
      throw searchError(res.status, r?.Error, r?.RequestId, text);
    },
  };
}

/** 元宝搜索错误码 → 用户可读的原因与处理办法（错误码见接入文档） */
export function searchError(status: number, error: { Code: string; Message: string } | undefined, requestId: string | undefined, raw: string) {
  const code = error?.Code ?? `HTTP ${status}`;
  const info = (hint: string) => ({ hint, code, requestId });
  const detail = raw.slice(0, 500);
  if (code === "UnauthorizedOperation" || code.startsWith("AuthFailure") || status === 401 || status === 403) {
    return new ProviderError("yuanbao", "元宝搜索不认这个 API Key", detail, "auth", info(
      "刚创建的密钥需要稍等片刻才会生效，可过一两分钟再试；" +
      "否则请确认填的是元宝搜索控制台「服务 API KEY」页创建时显示的完整明文密钥（sk- 开头，只显示一次），且没有被删除；" +
      "如果是子账号，需要主账号在访问管理中授予元宝搜索的全读写权限。"));
  }
  if (code === "ResourceNotFound") {
    return new ProviderError("yuanbao", "元宝搜索服务尚未开通", detail, "auth", info("请先在元宝搜索控制台的概览页开通服务。"));
  }
  if (code === "ResourceUnavailable") {
    return new ProviderError("yuanbao", "元宝搜索资源不可用", detail, "auth", info("请检查腾讯云账号是否欠费，或免费额度、资源包是否已用完。"));
  }
  if (code === "RequestLimitExceeded" || status === 429) {
    return new ProviderError("yuanbao", "搜索请求过于频繁", detail, "quota", info("请稍等片刻再试。"));
  }
  return new ProviderError("yuanbao", "元宝搜索请求失败", detail, "other", info(error?.Message ? `服务返回：${error.Message}` : `服务返回 HTTP ${status}`));
}

/** 设置页的连接测试：搜索一个固定词，返回服务版本供界面显示 */
export async function testYuanbao(cfg: YuanbaoConfig) {
  const p = createYuanbao(cfg);
  await p.search("腾讯", { count: 10 });
  const v = p.version();
  return v ? VERSION_LABEL[v] ?? v : undefined;
}
