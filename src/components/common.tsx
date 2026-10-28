import { ExternalLink, Globe } from "lucide-react";
import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import type { Source } from "../core/protocol.ts";
import { cardLabel, relativeTime } from "../lib/format.ts";
import { parseMarkdown } from "../lib/markdown.ts";
import type { Pic } from "../lib/pics.ts";
import { ImageViewer } from "./ImageViewer.tsx";
import { sentenceBefore } from "../lib/match.ts";
import { openCite } from "../store/cite.ts";
import { actions, useGraph } from "../store/graph.ts";
import { useSettings } from "../settings/store.ts";

const TILES = 6;
function tileOf(site: string) {
  let h = 0;
  for (const ch of site) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--tile-${(h % TILES) + 1})`;
}

/** 来源图标：优先使用站点 favicon，加载失败时显示站名首字 */
export function SourceIcon({ source, style }: { source: Source; style?: React.CSSProperties }) {
  const [broken, setBroken] = useState(false);
  const letter = (source.site || source.title).trim().charAt(0).toUpperCase();
  return (
    <span className="fav" style={{ background: broken || !source.favicon ? tileOf(source.site) : undefined, ...style }}>
      {source.favicon && !broken ? <img src={source.favicon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : letter}
    </span>
  );
}

export function SourceStack({ sources, max = 4 }: { sources: Source[]; max?: number }) {
  if (!sources.length) return null;
  return (
    <span className="favs">
      {sources.slice(0, max).map((s) => <SourceIcon key={s.id} source={s} />)}
    </span>
  );
}

/** 角标：点击打开引用气泡（来源标题与原文高亮）；quote 是被引用的那句话 */
export function Cites({ cites, sources, quote = "" }: { cites: number[]; sources?: Source[]; quote?: string }) {
  const nodeId = useContext(CiteNode);
  return (
    <>
      {cites.map((c) => {
        const s = sources?.[c - 1];
        if (!s) return <span key={c} className="cite">{c}</span>;
        return (
          <button
            key={c}
            type="button"
            className="cite"
            data-act="cite"
            aria-label={`来源 ${c}：${s.title}`}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              openCite({ source: s, n: c, quote, nodeId, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
            }}
          >
            {c}
          </button>
        );
      })}
    </>
  );
}

/** 角标所在的节点：气泡里「在侧边栏阅读」需要知道来源属于哪个节点（总结面板里没有） */
export const CiteNode = createContext<string | null>(null);

/**
 * 来源列表的一行：点击按设置用系统浏览器打开，或在侧边栏阅读视图里打开（需要 nodeId）；
 * 没有链接的权威卡片直接显示摘要。detail 时列出附件子链
 */
/** 推荐先问的标记：「先问」两个字用图表强调色（墨色方案的主题色是灰，不够醒目），后面跟半句理由 */
export function NextWhy({ why, replayId }: { why: string; replayId: string }) {
  return (
    <span className="next-why" data-replay-id={replayId}>
      <span className="next-why-label">先问</span>
      <span>{why}</span>
    </span>
  );
}

/** 并列的几项元信息（网站、时间、数量）：各自一段，用间距分开，不用分隔符号 */
export function MetaParts({ items, className }: { items: ReactNode[]; className?: string }) {
  const xs = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  return <span className={className ? `meta-parts ${className}` : "meta-parts"}>{xs.map((x, i) => <span key={i}>{x}</span>)}</span>;
}

export function SourceItem({ s, n, detail = false, nodeId }: { s: Source; n: number; detail?: boolean; nodeId?: string }) {
  const body = (
    <>
      <span className="n">{n}</span>
      <SourceIcon source={s} />
      <span className="source-main">
        <span className="source-title">{s.title}</span>
        <MetaParts className="meta" items={[
          s.card && <span className="source-badge">{cardLabel(s)}</span>,
          !s.card && (s.authority ?? 0) >= 4 && <span className="source-badge">权威</span>,
          s.text && <span className="source-badge is-read">已读全文</span>,
          s.site, relativeTime(s.date),
        ]} />
        {(!s.url || (detail && s.card)) && s.snippet && <span className={`source-snippet${s.card ? " is-card" : ""}`}>{s.snippet}</span>}
      </span>
      {s.url && <ExternalLink className="source-go" size={13} strokeWidth={1.6} />}
    </>
  );
  return (
    <li>
      {s.url ? (
        <a className="source" href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => {
          if (nodeId && useSettings.getState().openSource === "reader") { e.preventDefault(); actions.readSource(nodeId, n); }
        }}>{body}</a>
      ) : nodeId ? (
        <button type="button" className="source" onClick={() => actions.readSource(nodeId, n)}>{body}</button>
      ) : <div className="source">{body}</div>}
      {detail && s.links && s.links.length > 0 && (
        <ul className="source-links">
          {s.links.map((l) => (
            <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a></li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 模型输出用的 Markdown 子集：# / ## 标题、段落、「- 」列表；lead 时第一段正文作导语。
 * pics 为详解可用的配图（lib/pics.ts），正文里单独一行的 [图n] 渲染为带说明的插图；没有对应图或加载失败时不显示
 */
export function Markdown({ text, sources, streaming, lead = false, pics = [] }: { text: string; sources: Source[]; streaming: boolean; lead?: boolean; pics?: Pic[] }) {
  const blocks = parseMarkdown(text);
  const firstPara = lead ? blocks.findIndex((b) => b.type === "p") : -1;
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  // 关闭时保留图片地址，查看器的淡出动画里图片不会消失
  const [view, setView] = useState<{ url: string; open: boolean } | null>(null);
  const shown = new Set<number>();
  return (
    <>
      {blocks.map((b, i) => {
        const last = streaming && i === blocks.length - 1 ? <span className="caret" /> : null;
        if (b.type === "img") {
          const p = pics.find((x) => x.n === b.n);
          // 同一张图只放一次
          if (!p || broken.has(p.url) || shown.has(p.n)) return null;
          shown.add(p.n);
          return (
            <figure key={i} className="md-fig">
              <button type="button" className="md-fig-img" aria-label={`查看图片：${p.caption}`} onClick={() => setView({ url: p.url, open: true })}>
                <img src={p.url} alt={p.caption} loading="lazy" referrerPolicy="no-referrer" draggable={false}
                  onError={() => setBroken((s) => new Set(s).add(p.url))} />
              </button>
              <figcaption><span>{p.caption}</span><span className="md-fig-src">来源 {p.source}{p.site && ` ${p.site}`}</span></figcaption>
            </figure>
          );
        }
        if (b.type === "h") return b.level === 1 ? <h3 key={i}>{b.text}{last}</h3> : <h4 key={i}><CiteText text={b.text} sources={sources} />{last}</h4>;
        if (b.type === "p") return <p key={i} className={i === firstPara ? "lead" : undefined}><CiteText text={b.text} sources={sources} />{last}</p>;
        const List = b.type === "ol" ? "ol" : "ul";
        return (
          <List key={i} className="md-list">
            {b.items.map((t, j) => <li key={j}><CiteText text={t} sources={sources} />{j === b.items.length - 1 && last}</li>)}
          </List>
        );
      })}
      {view && <ImageViewer images={[view.url]} index={view.open ? 0 : null} onChange={() => {}} onClose={() => setView({ ...view, open: false })} />}
    </>
  );
}

/** 把文本中的 [n] 渲染为角标 */
function withCites(text: string, sources: Source[] | undefined, key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    parts.push(text.slice(last, m.index));
    parts.push(<Cites key={`${key}-${m.index}`} cites={[Number(m[1])]} sources={sources} quote={sentenceBefore(text, m.index!)} />);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** 正文：[n] 渲染为角标，**粗体** 渲染为加粗；流式输出中还没闭合的 ** 先不显示 */
export function CiteText({ text, sources }: { text: string; sources?: Source[] }) {
  const segs = text.split(/\*\*(.+?)\*\*/);
  const parts = segs.flatMap<ReactNode>((s, i) =>
    i % 2 ? [<strong key={`b${i}`}>{withCites(s, sources, `b${i}`)}</strong>] : withCites(s.replace(/\*\*/g, ""), sources, `t${i}`),
  );
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export function SearchToggle({ compact = false }: { compact?: boolean }) {
  const on = useGraph((s) => s.search);
  return (
    <button type="button" className="toggle" aria-pressed={on} onClick={actions.toggleSearch}>
      <Globe size={15} strokeWidth={1.6} />
      <span className={compact ? "toggle-label" : undefined}>联网搜索</span>
    </button>
  );
}
