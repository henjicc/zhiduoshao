import { Copy, FileDown, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Source, SummaryRequest } from "../core/protocol.ts";
import { api } from "../api/client.ts";
import { actions, chain, isReady, toContext, useGraph } from "../store/graph.ts";
import { fileName, reviewMd } from "../lib/export.ts";
import { copyText, saveMarkdown } from "../lib/save.ts";
import type { GNode } from "../store/types.ts";
import { Markdown, SourceItem } from "./common.tsx";
import { PathReview, unopened, type Learning } from "./PathReview.tsx";
import { usePresence } from "./presence.ts";
import { ThinkingStream } from "./ThinkingStream.tsx";

type Scope = SummaryRequest["scope"];
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "整张图" },
  { key: "path", label: "当前路径" },
  { key: "selection", label: "选中节点" },
];

function scopeNodes(scope: Scope, nodes: Record<string, GNode>, activeId: string | null, selected: string[]): GNode[] {
  if (scope === "selection") return selected.map((id) => nodes[id]).filter(isReady);
  if (scope === "path") return activeId && nodes[activeId] ? chain(nodes, activeId).filter(isReady) : [];
  const out: GNode[] = [];
  const walk = (n: GNode) => { if (isReady(n)) out.push(n); n.children.forEach((c) => walk(nodes[c])); };
  Object.values(nodes).filter((n) => !n.parent).forEach(walk);
  return out;
}

interface Result { text: string; thinking: string; sources: Source[]; status: "loading" | "streaming" | "ready" | "error"; error?: string }

/** 路径回看「已经弄清的」：只缓存在内存里、不存档；同一条路径内容没变时重新打开面板不再调用模型。
 * 键带地图 id 与每个节点的回答时间：节点编号每张地图都从 n1 起，重新回答后结论字数也可能不变 */
const learnedCache = new Map<string, Learning>();
const NO_LEARNED: Learning["items"] = [];

function useLearned(list: GNode[], on: boolean) {
  const mapId = useGraph((s) => s.map?.id ?? "");
  const key = `${mapId}|${list.map((n) => `${n.id}:${n.answeredAt}:${n.summary.length}`).join(",")}`;
  const [state, setState] = useState<{ key: string; value: Learning } | null>(null);
  useEffect(() => {
    if (!on || !list.length || learnedCache.has(key)) return;
    const ctrl = new AbortController();
    let acc: Learning = { status: "loading", items: [], sources: [] };
    setState({ key, value: acc });
    void api.review({ origin: list[0].q, nodes: list.map(toContext) }, (ev) => {
      if (ev.type === "sources") acc = { ...acc, sources: ev.sources };
      else if (ev.type === "learned") learnedCache.set(key, (acc = { ...acc, status: "ready", items: ev.items }));
      else if (ev.type === "error") acc = { ...acc, status: "error" };
      else return;
      setState({ key, value: acc });
    }, ctrl.signal);
    return () => ctrl.abort();
  }, [key, on]);
  // 缓存里有的在这一次渲染就给出，路径回看一挂载就知道要等对照的线画完再放出
  if (!on || !list.length) return null;
  return learnedCache.get(key) ?? (state?.key === key ? state.value : null);
}

export function SummarySheet() {
  const open = useGraph((s) => s.summaryOpen);
  const p = usePresence(open);
  return p.mounted ? <Sheet closing={p.closing} /> : null;
}

function Sheet({ closing }: { closing: boolean }) {
  const nodes = useGraph((s) => s.nodes);
  const activeId = useGraph((s) => s.activeId);
  const selected = useGraph((s) => s.selected);
  const hasSelection = selected.filter((id) => isReady(nodes[id])).length > 0;
  // 有选中节点时总结选中的；路径走到两层以上默认总结当前路径，顶部是路径回看；否则整张图
  const [scope, setScope] = useState<Scope>(() => (hasSelection ? "selection" : scopeNodes("path", nodes, activeId, selected).length >= 2 ? "path" : "all"));
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, Result>());

  const list = useMemo(() => scopeNodes(scope, nodes, activeId, selected), [scope, nodes, activeId, selected]);
  // 节点内容不变时复用上次的总结，避免重复调用模型
  const key = `${scope}:${list.map((n) => n.id + ":" + n.summary.length).join(",")}`;
  const isPath = scope === "path" && list.length > 0;
  const learned = useLearned(list, isPath);
  const learnedItems = learned?.status === "ready" ? learned.items : NO_LEARNED;
  const more = useMemo(() => (isPath ? unopened(list, nodes) : []), [isPath, list, nodes]);

  useEffect(() => {
    if (!list.length) { setResult(null); return; }
    const cached = attempt === 0 && cache.current.get(key);
    if (cached) { setResult(cached); return; }
    const ctrl = new AbortController();
    let acc: Result = { text: "", thinking: "", sources: [], status: "loading" };
    setResult(acc);
    void api.summary({ scope, nodes: list.map(toContext) }, (ev) => {
      if (ev.type === "sources") acc = { ...acc, sources: ev.sources };
      else if (ev.type === "text") acc = { ...acc, status: "streaming", text: acc.text + ev.delta };
      else if (ev.type === "thinking") acc = { ...acc, thinking: acc.thinking + ev.delta };
      else if (ev.type === "done") { acc = { ...acc, status: "ready" }; cache.current.set(key, acc); }
      else if (ev.type === "error") acc = { ...acc, status: "error", error: ev.message };
      else return;
      setResult(acc);
    }, ctrl.signal);
    return () => ctrl.abort();
  }, [key, attempt]);

  // 只列出正文与路径回看实际引用的来源，序号保持与角标一致（两边都按 mergeSources 合并同一组节点的来源）
  const cited = useMemo(() => {
    if (!result) return [];
    const used = new Set([...[...result.text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])), ...learnedItems.flatMap((x) => x.cites)]);
    return result.sources.map((s, i) => ({ s, i })).filter(({ i }) => used.has(i + 1));
  }, [result, learnedItems]);

  /** 总结正文加上实际引用的来源列表：复制和下载用同一份 Markdown。当前路径时路径回看放在总结标题之后、正文之前 */
  const markdown = () => {
    if (!result) return "";
    const refs = cited.map(({ s, i }) => `${i + 1}. ${s.url ? `[${s.title}](${s.url})` : `${s.title}（权威卡片，无链接）`}（${s.site}）`).join("\n");
    const doc = result.text.trim();
    const review = isPath ? reviewMd(list, learnedItems, more) : "";
    const h1 = /^#\s+.+$/m.exec(doc);
    const body = !review ? doc : h1 ? `${h1[0]}\n\n${review}\n\n${doc.replace(h1[0], "").trim()}` : `${review}\n\n${doc}`;
    return body + (refs ? `\n\n## 来源\n\n${refs}\n` : "\n");
  };
  /** 下载的文件名取总结的标题（第一行「# 标题」） */
  const title = () => result?.text.match(/^#\s+(.+)$/m)?.[1].trim() ?? "知多少总结";

  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" onClick={actions.closeSummary} />
      <section className="summary" role="dialog" aria-modal="true" aria-labelledby="summary-title">
        <header className="summary-head">
          <h2 id="summary-title">总结</h2>
          <div className="segmented" role="radiogroup" aria-label="总结范围">
            {SCOPES.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={scope === s.key} disabled={s.key === "selection" && !hasSelection}
                onClick={() => { setAttempt(0); setScope(s.key); }}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭总结" onClick={actions.closeSummary}>
            <X size={16} strokeWidth={1.6} />
          </button>
        </header>
        <article className="summary-body" aria-live="polite" aria-busy={result?.status === "loading" || result?.status === "streaming"}>
          {isPath && <PathReview list={list} learned={learned} more={more} sources={learned?.sources ?? []} />}
          {!list.length ? (
            <p className="summary-empty">这个范围里还没有已完成的回答</p>
          ) : result?.status === "error" ? (
            <div className="summary-error">
              <span>{result.error}</span>
              <button type="button" className="btn btn-sm" onClick={() => setAttempt((a) => a + 1)}><RotateCw size={13} strokeWidth={1.8} />重试</button>
            </div>
          ) : !result || result.status === "loading" ? (
            // 还没开始输出：上面滚动显示模型的思考，下面用带光泽的横条占住正文的位置；开始输出正文时整块换成内容
            <div className="summary-wait">
              {result?.thinking
                ? <ThinkingStream text={result.thinking} lines={4} className="summary-thinking" />
                : <p className="summary-wait-label">正在整理总结…</p>}
              <div className="skeleton summary-skeleton" aria-hidden="true">
                <i className="is-title" /><i /><i /><i /><i /><i /><i /><i /><i />
              </div>
            </div>
          ) : (
            <Markdown text={result.text} sources={result.sources} streaming={result.status === "streaming"} lead />
          )}
          {result && result.status === "ready" && cited.length > 0 && (
            <section className="summary-sources">
              <h4>来源</h4>
              <ol className="sources">
                {cited.map(({ s, i }) => <SourceItem key={s.id} s={s} n={i + 1} />)}
              </ol>
            </section>
          )}
        </article>
        <footer className="summary-foot">
          <span className="meta">{list.length} 个节点{cited.length ? `，引用 ${cited.length} 个来源` : ""}</span>
          <span className="summary-actions">
            <button type="button" className="btn" onClick={() => void copyText(markdown(), "已复制为 Markdown")} disabled={result?.status !== "ready"}>
              <Copy size={14} strokeWidth={1.6} />复制
            </button>
            <button type="button" className="btn" onClick={() => void saveMarkdown(fileName(title()), markdown())} disabled={result?.status !== "ready"}>
              <FileDown size={14} strokeWidth={1.6} />下载 Markdown
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}
