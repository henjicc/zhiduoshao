import { useRef, type CSSProperties } from "react";
import type { Learned, Source } from "../core/protocol.ts";
import { actions } from "../store/graph.ts";
import type { GNode } from "../store/types.ts";
import { Cites, NextWhy } from "./common.tsx";

/** 已经弄清的几件事：快模型整理中、整理好或失败（失败时整块不显示） */
export interface Learning { status: "loading" | "ready" | "error"; items: Learned[]; sources: Source[] }

/** 路径上还没点开的问题：推荐先问的排前面，其余越靠近现在的那一层越前，同一层里保持原来的顺序，最多 4 条 */
export function unopened(list: GNode[], nodes: Record<string, GNode>): GNode[] {
  const qs = [...list].reverse().flatMap((n) => n.children.map((c) => nodes[c]).filter((c): c is GNode => c?.kind === "question"));
  return [...qs.filter((q) => q.nextWhy), ...qs.filter((q) => !q.nextWhy)].slice(0, 4);
}

/**
 * 总结面板「当前路径」顶部的路径回看：起点和现在的对照（中间一条线，每走一步一个点，悬停看那一步的问题），
 * 已经弄清的几件事，还可以再看的问题（点一下关掉面板开始回答）。路径只有一层时不显示对照
 */
export function PathReview({ list, learned, more, sources }: { list: GNode[]; learned: Learning | null; more: GNode[]; sources: Source[] }) {
  const steps = list.slice(1);
  // 打开面板时已经整理好的（内存里有），等对照的线画完再逐条放出；现整理的本来就晚到，不再等
  const afterRoute = useRef(learned?.status === "ready" && steps.length > 0).current;
  return (
    <div className="review">
      {steps.length > 0 && (
        <section className="review-route" data-replay-id="review-route" aria-label="从起点到现在">
          <div className="review-side is-start">
            <span className="review-label">起点</span>
            <p className="review-q">{list[0].q}</p>
          </div>
          <div className="review-track" style={{ "--steps": steps.length } as CSSProperties}>
            <svg className="review-line" aria-hidden="true">
              <line pathLength={1} x1="0" y1="50%" x2="100%" y2="50%" />
              <line pathLength={1} className="is-v" x1="50%" y1="0" x2="50%" y2="100%" />
            </svg>
            {steps.map((n, i) => (
              <span key={n.id} className={`review-dot${i === steps.length - 1 ? " is-end" : ""}`} role="img" aria-label={n.q}
                style={{ "--at": (i + 1) / steps.length } as CSSProperties} />
            ))}
          </div>
          <div className="review-side is-now">
            <span className="review-label">现在</span>
            <p className="review-q">{steps[steps.length - 1].q}</p>
          </div>
        </section>
      )}
      {learned && learned.status !== "error" && (
        <section className="review-block" data-replay-id="review-learned">
          <h4>已经弄清的</h4>
          {learned.status === "loading" ? (
            <div className="skeleton review-skeleton" aria-hidden="true"><i /><i /><i /></div>
          ) : (
            <ul className={`md-list review-learned${afterRoute ? " is-after-route" : ""}`}>
              {learned.items.map((x, i) => (
                <li key={i} style={{ "--i": i } as CSSProperties}>{x.text}<Cites cites={x.cites} sources={sources} quote={x.text} /></li>
              ))}
            </ul>
          )}
        </section>
      )}
      {more.length > 0 && (
        <section className="review-block" data-replay-id="review-more">
          <h4>还可以再看的</h4>
          <div className="followups">
            {more.map((q) => (
              <button key={q.id} type="button" className="followup" onClick={() => { actions.closeSummary(); actions.ask(q.id); }}>
                <span className="pill-dir">{q.dir}</span>
                <span className="followup-body">
                  <span>{q.q}</span>
                  {q.nextWhy && <NextWhy why={q.nextWhy} replayId={`review-next-${q.id}`} />}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
