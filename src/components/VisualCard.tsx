import { ChartBar, ChartPie, ChartSpline, Gauge, Milestone, Table2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Source, Visual } from "../core/protocol.ts";
import { Cites } from "./common.tsx";

const ICON: Record<Visual["kind"], LucideIcon> = { table: Table2, timeline: Milestone, stats: Gauge, bar: ChartBar, line: ChartSpline, donut: ChartPie };

/** 图表里的数字：大数用万 / 亿缩写，小数最多两位 */
function fmt(n: number) {
  const a = Math.abs(n);
  if (a >= 1e8) return `${+(n / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${+(n / 1e4).toFixed(2)}万`;
  return String(+n.toFixed(2));
}
/** 单位是 % 或单个字时紧跟数字，其余隔一个空格 */
const withUnit = (n: number, unit: string) => (unit ? `${fmt(n)}${/^[%％]$|^.$/.test(unit) ? "" : " "}${unit}` : fmt(n));

/** 卡片里的角标：只显示前几个，其余折成「+N」，完整来源在节点的来源列表里 */
function FewCites({ cites, sources, quote, max = 2 }: { cites: number[]; sources: Source[]; quote: string; max?: number }) {
  return (
    <span className="visual-cite">
      <Cites cites={cites.slice(0, max)} sources={sources} quote={quote} />
      {cites.length > max && <span className="visual-cite-more">+{cites.length - max}</span>}
    </span>
  );
}

/** 智能卡片：把来源里的数据排成图表、表格、时间线或关键数字；每一项都带来源角标 */
export function VisualCard({ visual, sources }: { visual: Visual; sources: Source[] }) {
  const Icon = ICON[visual.kind];
  return (
    <figure className={`visual is-${visual.kind}`}>
      <figcaption className="visual-head">
        <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>{visual.title || DEFAULT_TITLE[visual.kind]}</span>
      </figcaption>
      <Body visual={visual} sources={sources} />
    </figure>
  );
}

const DEFAULT_TITLE: Record<Visual["kind"], string> = { table: "对比", timeline: "经过", stats: "关键数字", bar: "对比", line: "走势", donut: "构成" };

function Body({ visual: v, sources }: { visual: Visual; sources: Source[] }) {
  switch (v.kind) {
    case "table":
      return (
        <div className="visual-scroll">
          <table>
            <thead>
              <tr>{v.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}<th aria-label="来源" /></tr>
            </thead>
            <tbody>
              {v.rows.map((r, i) => (
                <tr key={i}>
                  {r.cells.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
                  <td className="visual-cites"><FewCites cites={r.cites} sources={sources} quote={r.cells.join(" ")} max={1} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "timeline":
      return (
        <ol className="visual-timeline">
          {v.items.map((x, i) => (
            <li key={i}>
              <span className="visual-time">{x.time}</span>
              <span className="visual-event">{x.text}<FewCites cites={x.cites} sources={sources} quote={x.text} /></span>
            </li>
          ))}
        </ol>
      );
    case "stats":
      return (
        <dl className="visual-stats">
          {v.items.map((x, i) => (
            <div key={i}>
              <dt>{x.label}</dt>
              <dd>{x.value}<FewCites cites={x.cites} sources={sources} quote={`${x.label} ${x.value}`} /></dd>
            </div>
          ))}
        </dl>
      );
    case "bar":
      return <Bars v={v} sources={sources} />;
    case "line":
      return <Line v={v} sources={sources} />;
    case "donut":
      return <Donut v={v} sources={sources} />;
  }
}

type Of<K extends Visual["kind"]> = Extract<Visual, { kind: K }>;

/** 横向柱状图：标签与数值在上、柱子在下，长名字也放得下；标了 highlight 的那一项用主题色，其余变灰 */
function Bars({ v, sources }: { v: Of<"bar">; sources: Source[] }) {
  const max = Math.max(...v.items.map((x) => x.value));
  const emphasis = v.items.some((x) => x.highlight);
  return (
    <ul className="visual-bars">
      {v.items.map((x, i) => (
        <li key={i} className={emphasis && !x.highlight ? "is-muted" : undefined}>
          <span className="visual-bar-label">{x.label}</span>
          <span className="visual-bar-value">{withUnit(x.value, v.unit)}<FewCites cites={x.cites} sources={sources} quote={`${x.label} ${withUnit(x.value, v.unit)}`} /></span>
          <span className="visual-bar-track"><span className="visual-bar-fill" style={{ width: `${max ? Math.max(1.5, (x.value / max) * 100) : 0}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

const W = 280;
const H = 92;
const PAD = { top: 18, right: 8, bottom: 6, left: 8 };

/** 折线图：单一系列用主题色，面积是同色淡层；标出首尾数值，悬停看每个点 */
function Line({ v, sources }: { v: Of<"line">; sources: Source[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ys = v.points.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (v.points.length - 1);
  const y = (n: number) => PAD.top + (1 - (n - lo) / span) * (H - PAD.top - PAD.bottom);
  const path = v.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const area = `${path}L${x(v.points.length - 1).toFixed(1)},${H - PAD.bottom}L${x(0).toFixed(1)},${H - PAD.bottom}Z`;
  const last = v.points.length - 1;
  const shown = hover ?? last;
  const cites = [...new Set(v.points.flatMap((p) => p.cites))].sort((a, b) => a - b);
  const anchor = (i: number) => (i === 0 ? "start" : i === last ? "end" : "middle");
  return (
    <>
      <div className="visual-line-head">
        <span className="visual-line-value">{withUnit(v.points[shown].y, v.unit)}</span>
        <span className="visual-line-x">{v.points[shown].x}</span>
        <span className="visual-line-cites"><FewCites cites={hover === null ? cites : v.points[hover].cites} sources={sources} quote={v.title} /></span>
      </div>
      <svg className="visual-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${v.title}：${v.points.map((p) => `${p.x} ${withUnit(p.y, v.unit)}`).join("，")}`} onPointerLeave={() => setHover(null)}>
        <path className="visual-line-area" d={area} />
        <path className="visual-line-path" d={path} />
        {hover !== null && <line className="visual-line-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top - 6} y2={H - PAD.bottom} />}
        {[0, last].map((i) => i !== hover && (
          <text key={i} className="visual-line-label" x={x(i)} y={y(v.points[i].y) - 8} textAnchor={anchor(i)}>{fmt(v.points[i].y)}</text>
        ))}
        {v.points.map((p, i) => (i === 0 || i === last || i === hover) && <circle key={i} className="visual-line-dot" cx={x(i)} cy={y(p.y)} r={4} />)}
        {/* 悬停区域比点大：每个点占一整列 */}
        {v.points.map((_, i) => (
          <rect key={i} className="visual-line-hit" x={x(i) - (W - PAD.left - PAD.right) / last / 2} y={0} width={(W - PAD.left - PAD.right) / last} height={H} onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      <div className="visual-line-axis"><span>{v.points[0].x}</span><span>{v.points[last].x}</span></div>
    </>
  );
}

/** 环形图：固定的分类色按顺序取用，切片之间留出底色细缝；图例带数值与占比，不靠颜色辨认 */
function Donut({ v, sources }: { v: Of<"donut">; sources: Source[] }) {
  const total = v.items.reduce((s, x) => s + x.value, 0);
  const R = 34, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="visual-donut">
      <svg viewBox="0 0 88 88" role="img" aria-label={`${v.title}：${v.items.map((x) => `${x.label} ${withUnit(x.value, v.unit)}`).join("，")}`}>
        {v.items.map((x, i) => {
          const len = (x.value / total) * C;
          const seg = <circle key={i} className="visual-donut-seg" cx={44} cy={44} r={R} stroke={`var(--viz-${i + 1})`} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} />;
          acc += len;
          return seg;
        })}
      </svg>
      <ul className="visual-legend">
        {v.items.map((x, i) => (
          <li key={i}>
            <i style={{ background: `var(--viz-${i + 1})` }} aria-hidden="true" />
            <span className="visual-legend-label">{x.label}</span>
            <span className="visual-legend-value">
              {withUnit(x.value, v.unit)}
              {v.unit !== "%" && v.unit !== "％" && <span className="visual-legend-share">{Math.round((x.value / total) * 100)}%</span>}
              <FewCites cites={x.cites} sources={sources} quote={`${x.label} ${withUnit(x.value, v.unit)}`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
