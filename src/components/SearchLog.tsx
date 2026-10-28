import { CalendarClock, ChartCandlestick, ChevronDown, Globe, GraduationCap, Landmark, Newspaper, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Industry, ResearchStep, SearchLog } from "../core/protocol.ts";
import type { GNode } from "../store/types.ts";
import { today } from "../core/prompts.ts";
import { approxCount, readWritten } from "../lib/format.ts";
import { MetaParts, SourceIcon } from "./common.tsx";

// 侧边栏「检索过程」：按研究助手实际做事的顺序画成一条时间线——拆成几个查询词、每轮同时查了哪些（参数跟在查询词后面）、
// 为什么还要补查、读了哪几篇全文、从去重后的结果里选出几条来源，最后是读了多少字、写成多少字。参数就是 API 请求里的字段，让「怎么查的」看得见。

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
    <>
      {p.freshness && <span className="search-param"><CalendarClock size={11} strokeWidth={1.8} aria-hidden="true" />{freshnessLabel(p.freshness)}</span>}
      {ind && <span className="search-param"><ind.icon size={11} strokeWidth={1.8} aria-hidden="true" />{ind.label}</span>}
      {p.site && <span className="search-param is-site"><Globe size={11} strokeWidth={1.8} aria-hidden="true" />{p.site}</span>}
    </>
  );
}

/** 早期存档只有每条查询的记录：按轮次拼回搜索步骤，没有补搜理由、去重数和读全文 */
function stepsOf(n: GNode): ResearchStep[] {
  if (n.steps.length) return n.steps;
  const out: Extract<ResearchStep, { kind: "search" }>[] = [];
  n.searches.forEach((s, i) => {
    if (i === 0 || s.round !== n.searches[i - 1].round) out.push({ kind: "search", round: s.round, results: 0, unique: 0, ms: 0, queries: [] });
    const cur = out[out.length - 1];
    cur.queries.push(s);
    cur.results += s.hits;
  });
  return out;
}

/** 第一步的说明：首轮查询用了哪些限定（领域、限定站点、时间），没有限定就不写 */
function planNote(qs: SearchLog[]) {
  const parts = [...new Set(qs.flatMap((q) => [q.industry && INDUSTRY[q.industry].label, q.site && "限定站点", q.freshness && freshnessLabel(q.freshness)]).filter(Boolean))];
  return parts.length ? `按问题限定${parts.join("、")}` : "";
}

export function SearchLogSection({ n }: { n: GNode }) {
  if (!n.searches.length) return null;
  const steps = stepsOf(n);
  const searches = steps.filter((s): s is Extract<ResearchStep, { kind: "search" }> => s.kind === "search");
  const first = searches[0];
  const unique = n.steps.length ? searches.reduce((sum, s) => sum + s.unique, 0) : 0;
  const done = n.status === "ready" || n.status === "streaming";
  const note = first ? planNote(first.queries) : "";
  // 综合节点的来源是合并来的，读写对比没有意义
  const written = n.status === "ready" && !n.links.length && n.sources.length > 0;
  let round = 0;
  return (
    <section className="drawer-section">
      <h3 className="section-title">
        检索过程
        <MetaParts className="section-meta" items={[`调用元宝搜索 ${n.searches.length} 次`, `返回 ${n.searchResults} 条`, n.searchMs > 0 && `用时 ${seconds(n.searchMs)}`]} />
      </h3>
      <ol className="research-steps">
        {first && (
          <li className="research-step">
            <div className="research-step-head"><b>拆成 {first.queries.length} 个查询词</b></div>
            {note && <div className="research-step-sub">{note}</div>}
          </li>
        )}
        {steps.map((s, i) => {
          if (s.kind === "read") {
            const failed = s.titles.length - s.ok;
            return (
              <li key={i} className="research-step">
                <div className="research-step-head"><b>读全文 {s.titles.length} 篇</b>{failed > 0 && <span className="research-num">{failed} 篇没读成</span>}</div>
                <div className="research-step-sub">{s.titles.join("、")}</div>
              </li>
            );
          }
          round++;
          const label = round === 1 ? `第 1 轮 · ${s.queries.length > 1 ? `同时查 ${s.queries.length} 个` : "查 1 个"}` : `第 ${round} 轮 · 补查 ${s.queries.length} 个`;
          return [
            round > 1 && (
              <li key={`why-${i}`} className="research-step">
                <div className="research-step-head"><b>判断：还不够</b></div>
                {s.reason && <div className="research-why">{s.reason}</div>}
              </li>
            ),
            <li key={i} className="research-step is-search">
              <div className="research-step-head"><b>{label}</b><span className="research-num">{s.results} 条</span></div>
              <ul className="research-queries">
                {s.queries.map((q, j) => (
                  <li key={j}>
                    <span className="research-q">{q.q}<Params p={q} /></span>
                    <span className="research-num">{q.hits}</span>
                  </li>
                ))}
              </ul>
            </li>,
          ];
        })}
        {done && n.dropped.length > 0 && <DroppedStep n={n} />}
        {done && n.sources.length > 0 && (
          <li className={`research-step${written ? "" : " is-done"}`}>
            <div className="research-step-head"><b>选出 {n.sources.length} 条来源</b>{unique > 0 && <span className="research-num">去重后 {unique} 条</span>}</div>
          </li>
        )}
        {written && <WrittenStep n={n} />}
      </ol>
    </section>
  );
}

/** 复查判定够了、剔除了哪些来源：默认收起，点开每行是网站图标、标题与理由，点一下用系统浏览器打开 */
function DroppedStep({ n }: { n: GNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="research-step" data-replay-id={`dropped-${n.id}`}>
      <button type="button" className="research-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <b>判断：够了，剔除 {n.dropped.length} 条</b>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropped">
          {n.dropped.map((d, i) => {
            const row = (
              <>
                <SourceIcon source={{ id: d.url, title: d.title, url: d.url, site: d.site, favicon: d.favicon, snippet: "" }} />
                <span className="dropped-title">{d.title}</span>
                {d.why && <span className="dropped-why">{d.why}</span>}
              </>
            );
            // 没有链接的权威卡片只列出来，不能点
            return <li key={i}>{d.url ? <a className="dropped-row" href={d.url} target="_blank" rel="noopener noreferrer">{row}</a> : <div className="dropped-row">{row}</div>}</li>;
          })}
        </ul>
      )}
    </li>
  );
}

/** 最后一步：读了多少、写成多少。细条整条是读的量，强调色的一小段是写的量，不看字也看得出差距 */
function WrittenStep({ n }: { n: GNode }) {
  const { read, written } = readWritten(n.sources, n.summary, n.points);
  return (
    <li className="research-step is-done" data-replay-id={`written-${n.id}`}>
      <div className="research-step-head"><b>写成答案</b></div>
      <div className="research-step-sub">读了约 {approxCount(read)} 字，写成 {written} 字</div>
      <div className="written-bar" aria-hidden="true"><i style={{ width: `max(2px, ${(written / Math.max(read, written, 1)) * 100}%)` }} /></div>
    </li>
  );
}
