import { ArrowUp, CalendarClock, RotateCw, Sparkles, TextSearch, X } from "lucide-react";
import { SOURCES_CAP } from "../core/protocol.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { actions, isReady, newsSince, useGraph } from "../store/graph.ts";
import type { GNode } from "../store/types.ts";
import { CiteNode, Markdown, SourceItem } from "./common.tsx";
import { Reader } from "./Reader.tsx";
import { clampDrawer, DRAWER_DEFAULT, settingsActions, useSettings } from "../settings/store.ts";
import { ThinkingStream } from "./ThinkingStream.tsx";
import { recordDetail } from "../memory/store.ts";
import { SearchLogSection } from "./SearchLog.tsx";
import { ImageViewer } from "./ImageViewer.tsx";
import { candidatePics } from "../lib/pics.ts";

const OP_LABEL = { summary: "总结", relate: "关联", deepen: "深入了解", expand: "扩散", custom: "指令" } as const;

export function Drawer() {
  const id = useGraph((s) => s.drawerId);
  const n = useGraph((s) => (s.drawerId ? s.nodes[s.drawerId] : undefined));
  const reading = useGraph((s) => s.reading);
  const open = !!n;
  // 关闭时保留上一次的内容，让滑出动画不出现空白
  const last = useRef(n);
  if (n) last.current = n;
  const shown = n ?? last.current;
  const readingN = reading && shown && reading.nodeId === shown.id ? reading.n : null;
  return (
    <aside className="drawer" aria-hidden={!open} aria-label={readingN ? "来源阅读" : "节点详情"} inert={!open}>
      <ResizeHandle />
      {shown && (readingN
        ? <Reader key={`${shown.id}:${readingN}`} node={shown} n={readingN} />
        : <CiteNode.Provider value={shown.id}><DrawerBody key={id ?? shown.id} n={shown} /></CiteNode.Provider>)}
    </aside>
  );
}

/** 拖动侧边栏左边缘调整宽度，记在设置里；双击恢复默认宽度 */
function ResizeHandle() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("is-resizing");
    const move = (ev: PointerEvent) => settingsActions.update({ drawerWidth: clampDrawer(innerWidth - ev.clientX) });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("is-resizing");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <div
      className="drawer-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整侧边栏宽度，双击恢复默认"
      onPointerDown={onPointerDown}
      onDoubleClick={() => settingsActions.update({ drawerWidth: DRAWER_DEFAULT })}
    />
  );
}

function DrawerBody({ n }: { n: GNode }) {
  const nodes = useGraph((s) => s.nodes);
  const [ask, setAsk] = useState("");
  const [view, setView] = useState<number | null>(null);
  const kind = n.links.length && n.op ? `${OP_LABEL[n.op]} ${n.links.length} 个节点` : n.dir;
  const questions = n.children.map((c) => nodes[c]).filter((c) => c?.kind === "question");
  const ready = isReady(n);
  const search = useGraph((s) => s.search);
  const canMore = ready && search && !n.links.length && n.sources.length > 0 && n.sources.length < SOURCES_CAP;
  const since = search ? newsSince(n) : null;

  return (
    <>
      {/* 卡片上已经有问题、结论和要点，侧边栏不再重复：标题栏只留一行问题作定位，正文从详解开始 */}
      <div className="drawer-head">
        <span className="drawer-head-title">
          {kind && <span className="drawer-kind">{kind}</span>}
          <span className="drawer-q">{n.q}</span>
        </span>
        <button type="button" className="icon-btn" aria-label="关闭详情" data-replay-id="drawer-close" onClick={actions.closeDrawer}>
          <X size={16} strokeWidth={1.6} />
        </button>
      </div>
      <div className="drawer-body">
        {n.images.length > 0 && (
          <div className={`drawer-images${n.images.length === 1 ? " is-single" : ""}`}>
            {n.images.map((url, i) => (
              <button key={i} type="button" className="drawer-image" aria-label={`查看图片 ${i + 1}`} onClick={() => setView(i)}>
                <img src={url} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
        {n.status === "error" ? (
          <p className="drawer-error">{n.error}{n.errorHint && <span className="card-error-hint">{n.errorHint}</span>}</p>
        ) : !ready && (
          <div className="skeleton drawer-skeleton"><i /><i /><i /></div>
        )}

        {n.links.length > 0 && (
          <section className="drawer-section">
            <h3 className="section-title">参考的节点</h3>
            <div className="followups">
              {n.links.map((l) => nodes[l] && (
                <button key={l} type="button" className="followup" onClick={() => actions.activate(l)}>
                  <span>{nodes[l].q}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {n.imageNote && (
          <section className="drawer-section">
            <h3 className="section-title">图片内容</h3>
            <p className="drawer-note">{n.imageNote}</p>
          </section>
        )}

        <DetailSection n={n} />

        <SearchLogSection n={n} />

        {n.sources.length > 0 && (
          <section className="drawer-section">
            <h3 className="section-title">来源{n.searchResults > 0 && !n.links.length && <span className="section-meta">从 {n.searchResults} 条结果中选出 {n.sources.length} 条</span>}</h3>
            <ol className="sources">
              {n.sources.map((s, i) => <SourceItem key={s.id} s={s} n={i + 1} nodeId={n.id} detail />)}
            </ol>
            {(canMore || since) && (
              <div className="drawer-more">
                {canMore && (
                  <button type="button" className="btn btn-sm" onClick={() => actions.moreSources(n.id)}>
                    <TextSearch size={13} strokeWidth={1.8} />搜索更多来源
                  </button>
                )}
                {since && (
                  <button type="button" className="btn btn-sm" onClick={() => actions.followNews(n.id)}>
                    <CalendarClock size={13} strokeWidth={1.8} />看看新进展
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {questions.length > 0 && (
          <section className="drawer-section">
            <h3 className="section-title">延伸问题</h3>
            <div className="followups">
              {questions.map((x) => (
                <button key={x.id} type="button" className="followup" onClick={() => actions.ask(x.id)}>
                  <span className="pill-dir">{x.dir}</span><span>{x.q}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <form
        className="drawer-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ask.trim() || !ready) return;
          actions.followup(n.id, ask.trim());
          setAsk("");
        }}
      >
        <label className="visually-hidden" htmlFor="drawer-ask-input">追问</label>
        <input id="drawer-ask-input" placeholder="追问" value={ask} maxLength={500} autoComplete="off" onChange={(e) => setAsk(e.target.value)} />
        <button type="submit" className="send send-sm" aria-label="发送追问" disabled={!ask.trim() || !ready}>
          <ArrowUp size={14} strokeWidth={2} />
        </button>
      </form>
      <ImageViewer images={n.images} index={view} onChange={setView} onClose={() => setView(null)} />
    </>
  );
}

/** 详解：卡片放精简回答，这里按需生成详细展开；打开详情时自动开始，生成后随存档保存 */
function DetailSection({ n }: { n: GNode }) {
  const ready = isReady(n);
  const auto = useSettings((s) => s.autoDetail);
  useEffect(() => {
    if (auto && ready && n.detailStatus === "idle") actions.loadDetail(n.id);
  }, [auto, ready, n.id, n.detailStatus]);
  // 与生成详解时交给模型的候选配图同一份，正文里的 [图n] 才对得上
  const pics = useMemo(() => candidatePics(n.sources), [n.sources]);
  if (!ready) return null;
  const st = n.detailStatus;
  return (
    <section className="drawer-section drawer-detail" aria-busy={st === "loading" || st === "streaming"}>
      <h3 className="section-title">详解</h3>
      {st === "idle" ? (
        <button type="button" className="btn btn-sm drawer-detail-start" onClick={() => { recordDetail(n.q, useGraph.getState().map?.id); actions.loadDetail(n.id); }}>
          <Sparkles size={13} strokeWidth={1.8} />生成详解
        </button>
      ) : st === "error" ? (
        <p className="drawer-detail-error">
          <span>详解没有生成成功</span>
          <button type="button" className="btn btn-sm" onClick={() => actions.loadDetail(n.id, true)}>
            <RotateCw size={13} strokeWidth={1.8} />重试
          </button>
        </p>
      ) : n.detail ? (
        <Markdown text={n.detail} sources={n.sources} streaming={st === "streaming"} pics={pics} />
      ) : n.thinking ? (
        <ThinkingStream text={n.thinking} lines={4} className="drawer-thinking" />
      ) : (
        <div className="skeleton drawer-skeleton"><i /><i /><i /></div>
      )}
    </section>
  );
}
