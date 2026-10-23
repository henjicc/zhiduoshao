import { ExternalLink, PanelRightOpen, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { relativeTime } from "../lib/format.ts";
import { findPassage, type Passage } from "../lib/match.ts";
import { closeCite, useCite, type CiteTarget } from "../store/cite.ts";
import { actions, useGraph } from "../store/graph.ts";
import { useSettings } from "../settings/store.ts";
import { MetaParts, SourceIcon } from "./common.tsx";

// 引用气泡：来源的标题、站点与原文，和这句回答相关的句子高亮；底部可以打开原网页（系统默认浏览器）。

const WIDTH = 380;
const GAP = 8;
/** 高亮句子前后各留几句上下文 */
const CONTEXT = 3;
/** 没有高亮时显示开头几句 */
const HEAD = 6;

export function CitePopover() {
  const open = useCite((s) => s.open);
  // 画布平移缩放、详情抽屉切换、页面滚动时关闭：角标已经不在原来的位置。
  // 不跟随节点内容变化——别的节点还在流式输出时，气泡不能被打断
  useEffect(() => {
    if (!open) return;
    const unsub = useGraph.subscribe((s, prev) => {
      if (s.view !== prev.view || s.drawerId !== prev.drawerId || s.screen !== prev.screen || s.summaryOpen !== prev.summaryOpen) closeCite();
    });
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest(".cite-pop"))) closeCite();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeCite(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".cite-pop, [data-act=cite]")) closeCite();
    };
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", onDown, true);
    addEventListener("resize", closeCite);
    addEventListener("scroll", onScroll, true);
    return () => {
      removeEventListener("scroll", onScroll, true);
      unsub();
      removeEventListener("keydown", onKey, true);
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("resize", closeCite);
    };
  }, [open]);
  return open ? <Pop key={`${open.source.id}:${open.n}:${open.quote}`} t={open} /> : null;
}

/** 在原文里找相关句子：读过全文的先在全文里找，找不到再回到搜索摘要 */
function passageOf(t: CiteTarget): Passage {
  const s = t.source;
  if (s.text) {
    const p = findPassage(s.text, t.quote);
    if (p.hits.length) return p;
  }
  return findPassage(s.snippet, t.quote);
}

function Pop({ t }: { t: CiteTarget }) {
  const ref = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const passage = useMemo(() => passageOf(t), [t]);
  const prefer = useSettings((x) => x.openSource);
  const s = t.source;

  // 优先放在角标下方，放不下就放上方；左右不超出窗口
  useLayoutEffect(() => {
    const h = ref.current!.offsetHeight;
    const left = Math.min(Math.max(12, t.anchor.left - 24), innerWidth - WIDTH - 12);
    const below = t.anchor.bottom + GAP;
    const top = below + h <= innerHeight - 12 ? below : Math.max(12, t.anchor.top - GAP - h);
    setPos({ left, top });
  }, [t]);

  // 高亮句子滚到可见处
  useEffect(() => {
    if (pos) mark.current?.scrollIntoView({ block: "center" });
  }, [pos]);

  const { sentences, hits } = passage;
  const from = hits.length ? Math.max(0, hits[0] - CONTEXT) : 0;
  const to = hits.length ? Math.min(sentences.length, hits[hits.length - 1] + CONTEXT + 1) : Math.min(sentences.length, HEAD);

  return (
    <div
      ref={ref}
      className="cite-pop"
      role="dialog"
      aria-label={`来源 ${t.n}`}
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <header className="cite-pop-head">
        <span className="cite-pop-n">{t.n}</span>
        <SourceIcon source={s} />
        <MetaParts className="cite-pop-meta" items={[s.site, relativeTime(s.date)]} />
        <button type="button" className="icon-btn cite-pop-close" aria-label="关闭" onClick={closeCite}><X size={14} strokeWidth={1.8} /></button>
      </header>
      <h4 className="cite-pop-title">{s.title}</h4>
      <div className="cite-pop-body">
        {from > 0 && <span className="cite-pop-gap">…</span>}
        {sentences.slice(from, to).map((x, i) =>
          hits.includes(from + i)
            ? <mark key={i} ref={from + i === hits[0] ? mark : undefined}>{x}</mark>
            : <span key={i}>{x}</span>,
        )}
        {to < sentences.length && <span className="cite-pop-gap">…</span>}
        {!sentences.length && <span className="cite-pop-empty">没有可显示的原文</span>}
      </div>
      <footer className="cite-pop-foot">
        {!hits.length && sentences.length > 0 && <span className="cite-pop-note">没有找到对应原文</span>}
        <span className="cite-pop-actions">
          {t.nodeId && (
            <button type="button" className={`cite-pop-act${prefer === "reader" ? " is-primary" : ""}`} onClick={() => { closeCite(); actions.readSource(t.nodeId!, t.n); }}>
              <PanelRightOpen size={12} strokeWidth={1.8} />在侧边栏阅读
            </button>
          )}
          {s.url && (
            <a className={`cite-pop-act${prefer === "browser" || !t.nodeId ? " is-primary" : ""}`} href={s.url} target="_blank" rel="noopener noreferrer" onClick={closeCite}>
              打开原网页<ExternalLink size={12} strokeWidth={1.8} />
            </a>
          )}
        </span>
      </footer>
    </div>
  );
}
