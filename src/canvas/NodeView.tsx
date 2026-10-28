import { ArrowRight, Brain, ChevronsRight, LoaderCircle, Minus, PanelRightOpen, Plus, RotateCw, Settings } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { history } from "../history/store.ts";
import { slotKey } from "./layout.ts";
import { CiteNode, CiteText, Cites, NextWhy, SourceIcon, SourceStack } from "../components/common.tsx";
import { ScrollThumb } from "../components/ScrollThumb.tsx";
import { ThinkingStream } from "../components/ThinkingStream.tsx";
import { splitPhrases, usePhraseReveal, useStagger, type Phrase } from "../components/smoothText.ts";
import { VisualCard } from "../components/VisualCard.tsx";
import { seconds } from "../components/SearchLog.tsx";
import { sourceMeta } from "../lib/format.ts";
import { settingsActions, useSettings } from "../settings/store.ts";
import { actions, useGraph } from "../store/graph.ts";
import type { GNode } from "../store/types.ts";

const OP_LABEL = { summary: "总结", relate: "关联", deepen: "深入了解", expand: "扩散", custom: "指令" } as const;

/** 卡片上的进度：只报阶段和累计数字。检索可能连着好几轮，每轮查了什么在详情的「检索过程」里看，卡片上不逐条播报 */
function stageText(n: GNode, search: boolean) {
  if (n.links.length && (n.stage === "read" || n.stage === "compose" || !n.stage)) return `正在综合 ${n.links.length} 个节点`;
  switch (n.stage) {
    case "see": return n.images.length > 1 ? `正在看 ${n.images.length} 张图片` : "正在看图";
    case "rewrite": return "理解问题";
    case "search":
    case "review":
      return n.searchResults ? `元宝搜索 ${seconds(n.searchMs)}返回 ${n.searchResults} 条结果` : "正在检索";
    case "fetch": return "正在阅读全文";
    // 拿到来源到答案开始输出之间，模型正在阅读来源
    case "read":
    case "compose":
      if (!n.sources.length) return "思考中";
      if (n.summary) return "整理答案";
      return n.searchResults ? `元宝搜索 ${seconds(n.searchMs)}返回 ${n.searchResults} 条，正在查阅 ${n.sources.length} 个来源` : `正在查阅 ${n.sources.length} 个来源`;
    default: return search ? "准备检索" : "思考中";
  }
}

/** 状态文字每条至少停留 STATUS_HOLD 再换，期间来的新状态只留最新一条；换的时候新旧两句叠化（旧的上移淡出、新的从下面浮上来），不留空白 */
const STATUS_HOLD = 1600;
function StatusText({ text, className }: { text: string; className: string }) {
  const [lines, setLines] = useState([{ key: 0, text, out: false }]);
  const since = useRef(Date.now());
  const current = lines[lines.length - 1].text;
  useEffect(() => {
    if (text === current) return;
    const t = setTimeout(() => {
      since.current = Date.now();
      setLines((xs) => [...xs.filter((x) => !x.out).map((x) => ({ ...x, out: true })), { key: xs[xs.length - 1].key + 1, text, out: false }]);
    }, Math.max(0, STATUS_HOLD - (Date.now() - since.current)));
    return () => clearTimeout(t);
  }, [text, current]);
  // 退出的那句播完就移除
  useEffect(() => {
    if (!lines.some((x) => x.out)) return;
    const t = setTimeout(() => setLines((xs) => xs.filter((x) => !x.out)), 800);
    return () => clearTimeout(t);
  }, [lines]);
  return (
    <span className={`status-swap ${className}`}>
      {lines.map((x) => <span key={x.key} className={x.out ? "is-out" : "is-in"} aria-hidden={x.out || undefined}>{x.text}</span>)}
    </span>
  );
}

/** 卡片高度跟着内容平滑伸缩：外层高度设成里层的实际高度，由 CSS 过渡追过去；第一次量到时直接就位，不从 0 长出来 */
function useSmoothHeight() {
  const body = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<{ px: number; animate: boolean; scroll: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = body.current!;
    const set = () => setH((v) => ({ px: el.offsetHeight, animate: v !== null, scroll: el.offsetHeight > shellMax(el.parentElement!) }));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const style: CSSProperties | undefined = h ? { height: h.px, transition: h.animate ? undefined : "none" } : undefined;
  return { body, style, scroll: !!h?.scroll };
}

/** 卡片内容区的最大高度（CSS 的 --card-max-h），超出就在卡片里滚动 */
function shellMax(shell: HTMLElement) {
  return parseFloat(getComputedStyle(shell).maxHeight) || Infinity;
}

/** 一段文字的分段浮现：已经放完的并成普通文字，正在浮现的每段单独淡入 */
function Revealed({ settled, fresh, sources }: { settled: string; fresh: Phrase[]; sources: GNode["sources"] }) {
  return (
    <>
      <CiteText text={settled} sources={sources} />
      {fresh.map((p) => <span key={p.key} className="ph"><CiteText text={p.text} sources={sources} /></span>)}
    </>
  );
}

function Tag({ n }: { n: GNode }) {
  if (n.compareOf) return <div className={`card-tag is-compare${n.searchMode === "off" ? " is-offline" : ""}`}>{n.searchMode === "off" ? "不联网回答" : "联网回答"}</div>;
  if (n.links.length && n.op) return <div className="card-tag is-link">{OP_LABEL[n.op]} {n.links.length} 个节点</div>;
  if (n.status === "error") return <div className="card-tag is-error">未完成</div>;
  if (!n.parent && !n.dir) return <div className="card-tag">初始提问</div>;
  return n.dir ? <div className="card-tag">{n.dir}</div> : null;
}

function Ticker({ n }: { n: GNode }) {
  if (!n.sources.length) return null;
  const list = n.sources.slice(0, 8);
  return (
    <span className="ticker" aria-hidden="true">
      {list.map((s, i) => (
        <SourceIcon key={s.id} source={s} style={{ animationDelay: `${(i * 1800) / list.length}ms` }} />
      ))}
    </span>
  );
}

function AnswerCard({ n, active }: { n: GNode; active: boolean }) {
  const search = useGraph((s) => s.search);
  const hidden = useGraph((s) => (n.collapsed ? countDescendants(s.nodes, n.id) : 0));
  const keepOpen = useSettings((s) => !s.autoCollapse);
  const opened = useGraph((s) => !!s.opened[n.id]);
  const showPoints = active || (keepOpen && opened);
  // 这张卡片是看着答出来的（挂载时还没答完）：结论先攒一点再分段浮现，图表、要点在结论放完后依次出现；打开历史地图时直接显示，不重播
  const live = useRef(n.status !== "ready").current;
  const summaryFinal = n.status !== "streaming" || n.points.length > 0 || !!n.visual;
  const summary = usePhraseReveal(n.summary, summaryFinal, live);
  const pointsShown = useStagger(n.points.length, summary.done, live);
  const { body, style, scroll } = useSmoothHeight();
  const shell = useRef<HTMLDivElement>(null);
  // 开始输出、但正文还在攒第一段时，继续显示加载状态和思考流：不然卡片会先缩一下再长回来
  const loading = n.status === "loading" || n.status === "idle" || (n.status === "streaming" && !summary.settled && !summary.fresh.length);
  const streaming = n.status === "streaming";

  return (
    <>
      <div className={`card${loading ? " is-loading" : ""}${streaming ? " is-streaming" : ""}${live ? " is-live" : ""}`} tabIndex={0}>
        <div ref={shell} className={`card-shell${scroll ? " is-scroll" : ""}`} style={style}>
          <div className="card-body" ref={body}>
            {/* 问题在左、标签在右上角，同一行；卡片内滚动时固定在顶部 */}
            <div className="card-head">
              <p className="card-q">{n.q}</p>
              <Tag n={n} />
            </div>
            <CardImages n={n} />
            {loading ? (
              <>
                <div className="status">
                  <StatusText className="status-text" text={stageText(n, search)} />
                  <Ticker n={n} />
                </div>
                {n.thinking
                  ? <ThinkingStream text={n.thinking} className="card-thinking" />
                  : <div className="skeleton card-skeleton"><i /><i /><i /></div>}
              </>
            ) : n.status === "error" ? (
              <div className="card-error">
                <span className="card-error-text">
                  <span>{n.error}</span>
                  {n.errorHint && <span className="card-error-hint">{n.errorHint}</span>}
                </span>
                <span className="card-error-actions">
                  {(n.errorCode === "auth" || n.errorCode === "config") && (
                    <button type="button" className="btn btn-sm" data-act="settings" onClick={settingsActions.open}>
                      <Settings size={13} strokeWidth={1.8} />设置
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" data-act="retry" onClick={() => actions.retry(n.id)}>
                    <RotateCw size={13} strokeWidth={1.8} />重试
                  </button>
                </span>
              </div>
            ) : (
              <>
                {n.summary && (
                  <p className="card-a"><Revealed settled={summary.settled} fresh={summary.fresh} sources={n.sources} /></p>
                )}
                {showPoints && summary.done && n.visual && <VisualCard visual={n.visual} sources={n.sources} />}
                {showPoints && pointsShown > 0 && <CardPoints n={n} count={pointsShown} live={live} />}
                {showPoints && n.memory && n.status === "ready" && pointsShown >= n.points.length && <MemoryLine m={n.memory} />}
                <div className="card-meta">
                  <SourceStack sources={n.sources} />
                  {streaming ? <StatusText className="meta status-text" text={stageText(n, search)} /> : <span className="meta">{sourceMeta(n.sources)}</span>}
                  <span className="card-actions">
                    <button type="button" className="icon-btn" data-act="detail" aria-label="查看详情" onClick={() => actions.openDrawer(n.id)}>
                      <PanelRightOpen size={14} strokeWidth={1.6} />
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        {scroll && <ScrollThumb scroller={shell} />}
      </div>
      {n.children.length > 0 && (
        <button
          type="button"
          className={`collapse-badge${n.collapsed ? " is-collapsed" : ""}`}
          data-act="collapse"
          aria-label={n.collapsed ? "展开分支" : "折叠分支"}
          onClick={() => actions.toggleCollapse(n.id)}
        >
          {n.collapsed ? <><Plus size={11} strokeWidth={2} /><span>{hidden}</span></> : <Minus size={11} strokeWidth={2} />}
        </button>
      )}
    </>
  );
}

/** 一条要点内部，相邻小段依次错开的时间 */
const PHRASE_STAGGER_MS = 160;

/** 卡片上的要点：完整显示（长度由模型控制）；看着答出来的卡片里，每条要点按小段依次浮现。回答完成后在下方提示可以去详情看详解 */
function CardPoints({ n, count, live }: { n: GNode; count: number; live: boolean }) {
  return (
    <>
      <ul className="points">
        {n.points.slice(0, count).map((p, i) => (
          <li key={i}>
            {live
              ? splitPhrases(p.text).map((s, j) => <span key={j} className="ph" style={{ animationDelay: `${j * PHRASE_STAGGER_MS}ms` }}>{s}</span>)
              : p.text}
            <Cites cites={p.cites} sources={n.sources} quote={p.text} />
          </li>
        ))}
      </ul>
      {n.status === "ready" && count >= n.points.length && (
        <button type="button" className="card-more" data-act="detail" onClick={() => actions.openDrawer(n.id)}>查看详解</button>
      )}
    </>
  );
}

/** 这次回答用到的个人记忆：为什么这样查、关联了哪张历史地图（点一下打开） */
function MemoryLine({ m }: { m: NonNullable<GNode["memory"]> }) {
  const parts: ReactNode[] = [];
  if (m.sites.length) parts.push(<span key="s">按你的记忆查了 {m.sites.join("、")}</span>);
  for (const r of m.recalls) {
    parts.push(
      <button key={r.mapId} type="button" className="card-memory-link" data-act="recall" onClick={() => void history.open(r.mapId)}>
        你探索过「{r.q.replace(/[？?]$/, "")}」
      </button>,
    );
  }
  return (
    <div className="card-memory">
      <Brain size={13} strokeWidth={1.7} aria-label="个人记忆" />
      <span className="card-memory-text">{parts}</span>
    </div>
  );
}

/** 提问时附的图片：卡片上只放小缩略图，大图在详情里看 */
function CardImages({ n }: { n: GNode }) {
  if (!n.images?.length) return null;
  return (
    <div className="card-images" aria-label={`附图 ${n.images.length} 张`}>
      {n.images.map((url, i) => <img key={i} src={url} alt="" draggable={false} />)}
    </div>
  );
}

function countDescendants(nodes: Record<string, GNode>, id: string): number {
  return nodes[id].children.reduce((s, c) => s + 1 + countDescendants(nodes, c), 0);
}

function QuestionPill({ n }: { n: GNode }) {
  return (
    <button type="button" className={`pill${n.nextWhy ? " is-next" : ""}`} onClick={(e) => { if (e.detail === 0) actions.ask(n.id); }}>
      <span className="pill-dir">{n.dir === "追问" ? <ChevronsRight size={12} /> : n.dir}</span>
      <span className="pill-body">
        <span className="pill-q">{n.q}</span>
        {n.nextWhy && <NextWhy why={n.nextWhy} replayId={`next-${n.id}`} />}
      </span>
      <ArrowRight className="pill-go" size={14} strokeWidth={1.6} />
    </button>
  );
}

export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const n = useGraph((s) => s.nodes[id]);
  const box = useGraph((s) => s.pos[id]);
  const measured = useGraph((s) => !!s.sizes[id]);
  const active = useGraph((s) => s.activeId === id);
  const selected = useGraph((s) => s.selected.includes(id));
  const dim = useGraph((s) => isDim(s, id));
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    // 卡片高度在平滑伸缩时，按里层内容的最终高度上报（不超过最大高度），布局一次排到位，不跟着动画逐帧重排
    const shell = el.querySelector<HTMLElement>(".card-shell");
    const body = el.querySelector<HTMLElement>(".card-body");
    const report = () => actions.setSize(id, el.offsetWidth, shell && body ? el.offsetHeight - shell.offsetHeight + Math.min(body.offsetHeight, shellMax(shell)) : el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    if (body) ro.observe(body);
    return () => ro.disconnect();
  }, [id]);

  if (!n || !box) return null;
  const cls = ["node", measured && "is-placed", active && "is-active", selected && "is-selected", dim && "dim", n.kind === "question" && "is-question", !n.parent && !n.links.length && "is-root"]
    .filter(Boolean).join(" ");
  return (
    <div ref={ref} className={cls} data-id={id} data-replay-id={`node-${id}`} style={{ transform: `translate(${box.x}px, ${box.y}px)` }}>
      {n.kind === "question" ? <QuestionPill n={n} /> : <CiteNode.Provider value={id}><AnswerCard n={n} active={active} /></CiteNode.Provider>}
    </div>
  );
});

/** 当前路径之外的节点变淡：路径 = 激活节点的祖先链、来源节点及其直接子节点 */
export function focusSets(s: { nodes: Record<string, GNode>; activeId: string | null }) {
  const a = s.activeId ? s.nodes[s.activeId] : null;
  if (!a) return null;
  const path = new Set<string>();
  for (let n: GNode | undefined = a; n; n = n.parent ? s.nodes[n.parent] : undefined) path.add(n.id);
  a.links.forEach((l) => path.add(l));
  const lit = new Set(path);
  a.children.forEach((c) => lit.add(c));
  return { path, lit };
}

function isDim(s: { nodes: Record<string, GNode>; activeId: string | null; selected: string[] }, id: string) {
  if (s.selected.includes(id)) return false;
  // 正在回答的节点不变淡：同时点开几个方向时，每个的进度都看得清
  const st = s.nodes[id]?.status;
  if (st === "loading" || st === "streaming") return false;
  const f = focusSets(s);
  return !!f && !f.lit.has(id);
}

/** 延伸列表底部的输入框：自己输入问题，或让模型补充新的探索方向（见 actions.command） */
export function AskSlot() {
  const slot = useGraph((s) => s.slot);
  const busy = useGraph((s) => s.slotBusy);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const parent = slot?.parent;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !parent) return;
    const report = () => actions.setSize(slotKey(parent), el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [parent]);

  // 换了节点就清空没发出的内容
  useEffect(() => setText(""), [parent]);

  if (!slot) return null;
  const submit = () => {
    if (actions.command(slot.parent, text)) setText("");
  };
  return (
    <div ref={ref} className="node is-slot is-placed" data-act="slot" style={{ transform: `translate(${slot.box.x}px, ${slot.box.y}px)` }}>
      <form className={`slot${busy ? " is-busy" : ""}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {busy ? <LoaderCircle className="spin slot-icon" size={13} strokeWidth={1.8} /> : <Plus className="slot-icon" size={13} strokeWidth={1.8} />}
        <input
          value={text}
          maxLength={500}
          disabled={busy}
          placeholder={busy ? "正在理解…" : "输入问题，或想展开的方向"}
          aria-label="追问或补充方向"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="slot-send" aria-label="发送" disabled={busy || !text.trim()}>
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
      </form>
    </div>
  );
}
