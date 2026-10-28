import type { Source } from "../core/protocol.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 来源发布时间的显示。元宝的 date 形如「2026/10/23 21:39:54」，多数带具体时刻（精确到分钟、甚至秒）；
 * 只有日期的写成 00:00:00。带时刻的显示到分钟（今天 21:39、昨天 08:15、10月19日 21:39，跨年带年份），
 * 让「分钟级更新」看得见（用户要求）；只有日期的按天显示相对时间（今天、3 天前……）
 */
export function relativeTime(date: string | undefined, now = Date.now()): string | null {
  if (!date) return null;
  const t = Date.parse(date.length === 10 ? date + "T00:00:00" : date);
  if (Number.isNaN(t) || t > now + 60_000) return null;
  const d = new Date(t), today = new Date(now);
  // 按日历日算相差几天，不按 24 小时：昨晚 23 点的消息在今早是「昨天」
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  if (hasTime) {
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (days === 0) return `今天 ${clock}`;
    if (days === 1) return `昨天 ${clock}`;
    const md = `${d.getMonth() + 1}月${d.getDate()}日`;
    return d.getFullYear() === today.getFullYear() ? `${md} ${clock}` : `${d.getFullYear()}年${md} ${clock}`;
  }
  if (days === 0) return "今天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
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
  // 时效指最新一条来源的发布时间，不是提问时间；写明「最新信息发布于」以免误读
  return `${sources.length} 个来源${f ? `，最新信息发布于${/^\d/.test(f) ? " " : ""}${f}` : ""}`;
}

/** 权威卡片的类别名：只收实测见过的类别，其余只显示「权威卡片」 */
const CARD_TYPES: Record<string, string> = { weather: "天气" };
export const cardLabel = (s: Source) => (s.cardType && CARD_TYPES[s.cardType] ? `${CARD_TYPES[s.cardType]}卡片` : "权威卡片");

export const short = (s: string, len = 18) => (s.length > len ? s.slice(0, len) + "…" : s);
