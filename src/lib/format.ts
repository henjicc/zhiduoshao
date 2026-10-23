import type { Source } from "../core/protocol.ts";

/** 来源日期 → 相对时间标签 */
export function relativeTime(date: string | undefined, now = Date.now()): string | null {
  if (!date) return null;
  const t = Date.parse(date.length === 10 ? date + "T00:00:00" : date);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now - t) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "今天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return date.slice(0, 10);
}

/** 节点时效：取最新的来源日期 */
export function freshness(sources: Source[]): string | null {
  const dated = sources
    .map((s) => ({ s, t: s.date ? Date.parse(s.date) : NaN }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => b.t - a.t);
  return dated.length ? relativeTime(dated[0].s.date) : null;
}

export function sourceMeta(sources: Source[]) {
  if (!sources.length) return "未联网回答";
  const f = freshness(sources);
  // 时效指最新一条来源的发布时间，不是提问时间；写明「最新发布于」以免误读
  return `${sources.length} 个来源${f ? `，最新发布于${/^\d/.test(f) ? " " : ""}${f}` : ""}`;
}

/** 权威卡片的类别名：只收实测见过的类别，其余只显示「权威卡片」 */
const CARD_TYPES: Record<string, string> = { weather: "天气" };
export const cardLabel = (s: Source) => (s.cardType && CARD_TYPES[s.cardType] ? `${CARD_TYPES[s.cardType]}卡片` : "权威卡片");

export const short = (s: string, len = 18) => (s.length > len ? s.slice(0, len) + "…" : s);
