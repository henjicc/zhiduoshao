import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readPage } from "../api/client.ts";
import { fullTextIssue, type Source } from "../core/protocol.ts";
import { openExternal } from "../lib/external.ts";
import { relativeTime, short } from "../lib/format.ts";
import { findPassage, quotesFor, splitSentences } from "../lib/match.ts";
import { actions } from "../store/graph.ts";
import type { GNode } from "../store/types.ts";
import { MetaParts, SourceIcon } from "./common.tsx";

// 侧边栏的来源阅读视图：网页正文（没读过的先读全文，读不到就用搜索摘要），
// 这个节点里引用了这条来源的每一句都在原文里高亮，顶部可以逐处跳转；← → 切换来源，Esc 返回详情。

type Load = { state: "idle" | "loading" | "done" } | { state: "error"; reason: string };

export function Reader({ node, n }: { node: GNode; n: number }) {
  const s = node.sources[n - 1];
  const total = node.sources.length;
  const body = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ state: s?.text || !s?.url ? "done" : "idle" });
  const [active, setActive] = useState<number | null>(null);

  // 没读过全文的来源：打开时读取，读到后写回节点（之后写答案、引用气泡也能用）
  useEffect(() => {
    if (!s || s.text || !s.url) return;
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    readPage(s.url, ctrl.signal).then(
      (page) => {
        const issue = fullTextIssue(s, page.text);
        if (issue) return setLoad({ state: "error", reason: issue });
        actions.setSourceText(node.id, s.id, page.text);
        setLoad({ state: "done" });
      },
      (err) => { if (!ctrl.signal.aborted) setLoad({ state: "error", reason: err instanceof Error ? err.message : String(err) }); },
    );
    return () => ctrl.abort();
  }, [node.id, s?.url]);

  // ← → 切换来源，Esc 回到详情（捕获阶段处理，避免同时关掉整个侧边栏）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.matches("input, textarea")) return;
      if (e.key === "Escape") { e.stopPropagation(); actions.closeReader(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); actions.stepSource(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); actions.stepSource(1); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  const view = useMemo(() => (s ? layoutText(s, quotesFor(node, n)) : null), [s, node.summary, node.points, node.detail, n]);
  if (!s || !view) return null;

  const jump = (qi: number) => {
    setActive(qi);
    const first = view.quotes[qi].hits[0];
    body.current?.querySelector(`[data-s="${first}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <>
      <div className="drawer-head reader-head">
        <button type="button" className="reader-back" onClick={actions.closeReader}>
          <ArrowLeft size={14} strokeWidth={1.8} />详情
        </button>
        <MetaParts className="reader-crumb" items={[short(node.q, 14), `来源 ${n}/${total}`]} />
        <span className="reader-nav">
          <button type="button" className="icon-btn" aria-label="上一条来源" onClick={() => actions.stepSource(-1)} disabled={total < 2}><ChevronLeft size={16} strokeWidth={1.6} /></button>
          <button type="button" className="icon-btn" aria-label="下一条来源" onClick={() => actions.stepSource(1)} disabled={total < 2}><ChevronRight size={16} strokeWidth={1.6} /></button>
          {s.url && <button type="button" className="icon-btn" aria-label="在浏览器中打开" onClick={() => openExternal(s.url)}><ExternalLink size={15} strokeWidth={1.6} /></button>}
          <button type="button" className="icon-btn" aria-label="关闭侧边栏" onClick={actions.closeDrawer}><X size={16} strokeWidth={1.6} /></button>
        </span>
      </div>
      <div className="drawer-body reader-body" ref={body}>
        <div className="reader-source"><SourceIcon source={s} /><MetaParts items={[s.site, relativeTime(s.date)]} /></div>
        <h2 className="reader-title">{s.title}</h2>

        {view.quotes.length > 0 && (
          <section className="reader-quotes">
            <p className="section-title">引用了 {view.quotes.length} 处</p>
            <div className="reader-chips">
              {view.quotes.map((q, i) => (
                <button key={i} type="button" className={`reader-chip${active === i ? " is-on" : ""}${q.hits.length ? "" : " is-miss"}`} disabled={!q.hits.length} onClick={() => jump(i)}>
                  {short(q.text, 22)}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="reader-status">
          {load.state === "loading" && <><LoaderCircle className="spin" size={13} strokeWidth={1.8} />正在读取网页全文，先显示搜索摘要</>}
          {load.state === "error" && <>没能读取全文（{load.reason}），下面是搜索摘要{s.url && <button type="button" className="reader-link" onClick={() => openExternal(s.url)}>在浏览器中打开</button>}</>}
          {load.state === "done" && (s.text ? "网页正文" : "搜索摘要")}
        </div>

        <article className="reader-text">
          {view.paragraphs.map((para, pi) => (
            <p key={pi}>
              {para.map(({ i, text }) => {
                const owners = view.owner.get(i);
                if (!owners) return <span key={i}>{text}</span>;
                const on = active !== null && owners.includes(active);
                return <mark key={i} data-s={i} className={on ? "is-on" : undefined}>{text}</mark>;
              })}
            </p>
          ))}
        </article>
      </div>
    </>
  );
}

/** 按段落排版原文，并算出每处引用对应的句子；句子编号与 findPassage 的切句一致 */
function layoutText(s: Source, quotes: string[]) {
  const text = s.text ?? s.snippet;
  const paragraphs: { i: number; text: string }[][] = [];
  let i = 0;
  for (const para of text.replace(/\r/g, "").split(/\n+/)) {
    const sentences = splitSentences(para);
    if (!sentences.length) continue;
    paragraphs.push(sentences.map((t) => ({ i: i++, text: t })));
  }
  const found = quotes.map((q) => ({ text: q, hits: findPassage(text, q).hits }));
  const owner = new Map<number, number[]>();
  found.forEach((q, qi) => q.hits.forEach((h) => owner.set(h, [...(owner.get(h) ?? []), qi])));
  return { paragraphs, quotes: found, owner };
}
