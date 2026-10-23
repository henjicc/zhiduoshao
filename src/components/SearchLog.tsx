import { CalendarClock, ChartCandlestick, Globe, GraduationCap, Landmark, Newspaper, type LucideIcon } from "lucide-react";
import type { Industry, SearchLog } from "../core/protocol.ts";
import type { GNode } from "../store/types.ts";
import { today } from "../core/prompts.ts";
import { MetaParts } from "./common.tsx";

// 侧边栏「检索过程」：这次回答向元宝搜索发了哪些查询、每条带了什么参数（时效、领域、限定站点）、各返回几条。
// 参数就是 API 请求里的字段，这里把它们摆出来，让「怎么查的」看得见。

const INDUSTRY: Record<Industry, { label: string; icon: LucideIcon }> = {
  gov: { label: "政府", icon: Landmark },
  news: { label: "新闻", icon: Newspaper },
  acad: { label: "学术", icon: GraduationCap },
  finance: { label: "财经", icon: ChartCandlestick },
};

/** 时效参数的说法：d7 → 近 7 天、m6 → 近半年、日期区间 → 某天至今 */
export function freshnessLabel(f: string) {
  const m = /^([dmy])(\d+)$/.exec(f);
  if (m) {
    const n = Number(m[2]);
    if (m[1] === "d") return n === 1 ? "今天" : `近 ${n} 天`;
    if (m[1] === "m") return n === 6 ? "近半年" : `近 ${n} 个月`;
    return `近 ${n} 年`;
  }
  const [a, b] = f.split(",");
  if (!b) return a;
  const short = (d: string) => d.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, "$1月$2日");
  return b === today() ? `${short(a)}至今` : `${short(a)}至${short(b)}`;
}

/** 耗时：统一按秒、保留一位小数（0.5 秒比 503 毫秒好读），不足 0.1 秒记 0.1 秒 */
export const seconds = (ms: number) => `${(Math.max(ms, 100) / 1000).toFixed(1)} 秒`;

function Params({ p }: { p: SearchLog }) {
  const ind = p.industry ? INDUSTRY[p.industry] : null;
  return (
    <span className="search-params">
      {p.freshness && <span className="search-param"><CalendarClock size={11} strokeWidth={1.8} aria-hidden="true" />{freshnessLabel(p.freshness)}</span>}
      {ind && <span className="search-param"><ind.icon size={11} strokeWidth={1.8} aria-hidden="true" />{ind.label}</span>}
      {p.site && <span className="search-param is-site"><Globe size={11} strokeWidth={1.8} aria-hidden="true" />{p.site}</span>}
    </span>
  );
}

export function SearchLogSection({ n }: { n: GNode }) {
  if (!n.searches.length) return null;
  // 相邻且同一轮的查询归为一组（搜索更多来源会从第 1 轮重新计，按出现顺序编号）；
  // 只在补充的那一轮前加标题，不回头给第一轮补标题，否则检索进行中列表顶部会突然多出一行
  let group = 0;
  const groups = n.searches.map((s, i) => (i === 0 || s.round !== n.searches[i - 1].round ? ++group : group));
  const starts = (i: number) => i === 0 || groups[i] !== groups[i - 1];
  return (
    <section className="drawer-section">
      <h3 className="section-title">
        检索过程
        <MetaParts className="section-meta" items={[`元宝搜索 ${n.searches.length} 次查询`, `${n.searchResults} 条结果`, n.searchMs > 0 && `用时 ${seconds(n.searchMs)}`]} />
      </h3>
      <ol className="search-log">
        {n.searches.map((s, i) => (
          <li key={i} className={i > 0 && starts(i) ? "is-next-round" : undefined}>
            {groups[i] > 1 && starts(i) && <span className="search-round">第 {groups[i]} 轮补充检索</span>}
            <span className="search-index">{i + 1}</span>
            <span className="search-q">{s.q}</span>
            <span className="search-hits">{s.hits} 条</span>
            <Params p={s} />
          </li>
        ))}
      </ol>
    </section>
  );
}
