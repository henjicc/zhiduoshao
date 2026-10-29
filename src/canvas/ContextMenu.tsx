import { ArrowRight, Columns2, Copy, FileDown, Maximize, MessageSquarePlus, PanelRightOpen, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fileName, nodesMd, treeOrder } from "../lib/export.ts";
import { copyText, saveMarkdown } from "../lib/save.ts";
import type { GNode } from "../store/types.ts";
import { actions, fit, isReady, useGraph } from "../store/graph.ts";
import { rootOf } from "../history/snapshot.ts";
import { usePresence } from "../components/presence.ts";

/** 右键位置：屏幕坐标、对应的画布坐标，以及点中的节点（空白处为 null） */
export interface MenuAt { x: number; y: number; wx: number; wy: number; nodeId: string | null; text: string }

interface Item { icon: LucideIcon; label: string; run: () => void }

function itemsFor(at: MenuAt, ask: () => void): Item[][] {
  const { nodes, selected } = useGraph.getState();
  const n = at.nodeId ? nodes[at.nodeId] : null;
  const copy: Item[] = at.text ? [{ icon: Copy, label: "复制", run: () => void copyText(at.text) }] : [];
  if (n?.kind === "question") return [copy, [{ icon: ArrowRight, label: "回答这个问题", run: () => actions.ask(n.id) }]];
  if (n) {
    // 变回原来那条延伸问题，回答和子树去掉（轻提示里可撤销）；还在回答时也能关，点错了不用等它答完。根节点没有可以变回去的问题
    const close: Item[] = n.parent ? [{ icon: X, label: "关闭", run: () => actions.close(n.id) }] : [];
    if (!isReady(n)) return [copy, close];
    const many = selected.includes(n.id) ? selected.map((id) => nodes[id]).filter(isReady) : [];
    return [copy, [
      { icon: PanelRightOpen, label: "打开详情", run: () => actions.openDrawer(n.id) },
      // 重新检索并重新回答，节点只留这次的结果；已经点开回答过的子节点保留
      { icon: RefreshCw, label: "重新回答", run: () => actions.retry(n.id) },
      // 对比节点自己不再提供，免得一路对比下去
      ...(n.compareOf ? [] : [{ icon: Columns2, label: compareLabel(n), run: () => actions.compare(n.id) }]),
    ], [
      // 导出都是存成 Markdown 文件；右键的节点在多选里时，同时提供合并导出
      { icon: FileDown, label: "导出", run: () => void saveMarkdown(fileName(n.q), nodesMd([n])) },
      ...(many.length > 1 ? [{ icon: FileDown, label: `导出选中的 ${many.length} 个节点`, run: () => void saveMarkdown(fileName(mapTitle()), nodesMd(many, mapTitle())) }] : []),
    ], close];
  }
  const all = treeOrder(nodes);
  return [[
    { icon: MessageSquarePlus, label: "新建问题", run: ask },
  ], all.length ? [
    { icon: FileDown, label: "导出", run: () => void saveMarkdown(fileName(mapTitle()), nodesMd(all, mapTitle())) },
  ] : [], [
    { icon: Maximize, label: "适应画布", run: fit },
  ]];
}

/** 对比：原节点联网了就断网再答一次，反过来也一样；对比节点卡片上的标签用同一套说法（NodeView 的 Tag） */
const compareLabel = (n: GNode) => (n.sources.length ? "断网对比" : "联网对比");

const mapTitle = () => rootOf(useGraph.getState().nodes)?.q ?? "知多少";

/** 弹层不超出窗口：贴着右边或底边时往回收 */
function useClamp(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  return { ref, pos };
}

/** 画布的右键菜单：节点上是详情、重新回答、对比、导出与关闭，空白处是新建问题、导出整张地图与适应画布 */
export function ContextMenu({ at, onClose }: { at: MenuAt | null; onClose: () => void }) {
  const [asking, setAsking] = useState<MenuAt | null>(null);
  const shown = useRef(at);
  if (at) shown.current = at;
  const p = usePresence(!!at, 120);

  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".ctx-menu")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    addEventListener("blur", close);
    addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      removeEventListener("blur", close);
      removeEventListener("resize", close);
    };
  }, [at, onClose]);

  // 挂到 body 上：用屏幕坐标定位，不受画布缩放影响
  return createPortal(
    <>
      {p.mounted && shown.current && <Menu at={shown.current} closing={p.closing} onClose={onClose} onAsk={() => setAsking(shown.current)} />}
      {asking && <AskHere at={asking} onDone={() => setAsking(null)} />}
    </>,
    document.body,
  );
}

function Menu({ at, closing, onClose, onAsk }: { at: MenuAt; closing: boolean; onClose: () => void; onAsk: () => void }) {
  const { ref, pos } = useClamp(at.x, at.y);
  const groups = itemsFor(at, onAsk).filter((g) => g.length);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [ref]);
  if (!groups.length) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...ref.current!.querySelectorAll<HTMLButtonElement>("button")];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
  };
  return (
    <div ref={ref} className={`ctx-menu${closing ? " is-closing" : ""}`} role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {groups.map((g, i) => (
        <div key={i} className="ctx-group" role="group">
          {g.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="ctx-item" onClick={() => { onClose(); it.run(); }}>
              <it.icon size={14} strokeWidth={1.6} aria-hidden="true" />
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 右键空白处「新建问题」：在点击的位置弹出输入框，回车后在那里长出一棵新的树 */
function AskHere({ at, onDone }: { at: MenuAt; onDone: () => void }) {
  const [text, setText] = useState("");
  const { ref, pos } = useClamp(at.x, at.y);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    const q = text.trim();
    if (!q) return;
    onDone();
    actions.startHere(q, at.wx, at.wy);
  };
  return (
    <div ref={ref} className="ctx-ask" style={{ left: pos.x, top: pos.y }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <MessageSquarePlus className="ctx-ask-icon" size={14} strokeWidth={1.6} aria-hidden="true" />
        <input
          ref={input}
          value={text}
          maxLength={500}
          placeholder="新问题"
          aria-label="新问题"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onDone(); }}
          onBlur={() => { if (!text.trim()) onDone(); }}
        />
        <button type="submit" className="slot-send" aria-label="提问" disabled={!text.trim()}>
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
      </form>
    </div>
  );
}
