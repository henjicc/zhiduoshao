import { useCallback, useEffect, useRef, useState } from "react";
import { actions, chain, isReady, setView, useGraph, zoomAt, ZOOM_MAX, ZOOM_MIN } from "../store/graph.ts";
import { edgePath } from "./layout.ts";
import { usePresence } from "../components/presence.ts";
import { AskSlot, focusSets, NodeView } from "./NodeView.tsx";
import { ContextMenu, type MenuAt } from "./ContextMenu.tsx";
import "../styles/canvas.css";

const LOD_FAR = 0.55;
const DRAG_THRESHOLD = 4;
/** 视角停止变化多久后撤掉合成图层、按最终比例重绘 */
const SETTLE_MS = 180;
/** 与 canvas.css 里 .world.glide 的时长一致：自动移动视角期间一直保持合成图层 */
const GLIDE_MS = 600;

/** 平滑缩放的时间常数：首帧就开始移动，约 150ms 收敛，既柔和又不拖沓 */
const ZOOM_TAU = 50;

/** 滚轮平滑缩放：滚轮只累加目标比例，每帧在对数空间里按指数趋近目标，锚点是最近一次滚轮的指针位置 */
function createSmoothZoom() {
  let target = 1, cx = 0, cy = 0, raf = 0, lastT = 0, lastS = 0;
  const scale = () => useGraph.getState().view.s;
  const frame = (t: number) => {
    const s = scale();
    // 过程中比例被其他操作改掉（捏合、适应窗口、按钮缩放）：放弃剩余的缩放
    if (s !== lastS) { raf = 0; return; }
    const k = 1 - Math.exp(-Math.max(1, t - lastT) / ZOOM_TAU);
    lastT = t;
    const ratio = target / s;
    zoomAt(Math.abs(ratio - 1) < 0.001 ? ratio : ratio ** k, cx, cy);
    lastS = scale();
    raf = lastS === target || Math.abs(target / lastS - 1) < 1e-4 ? 0 : requestAnimationFrame(frame);
  };
  return {
    by(factor: number, x: number, y: number) {
      const s = scale();
      if (!raf || s !== lastS) target = s;
      target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target * factor));
      cx = x; cy = y;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return zoomAt(target / s, x, y);
      if (!raf) {
        lastS = s;
        lastT = performance.now() - 16;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

type Drag =
  | { type: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { type: "node"; sx: number; sy: number; id: string; orig: Record<string, { dx: number; dy: number }>; moved: boolean }
  | { type: "marquee"; sx: number; sy: number; base: string[]; moved: boolean }
  /** 在卡片正文上按下：交给浏览器选择文字，没拖动、也没选中文字时按点击处理 */
  | { type: "text"; sx: number; sy: number; id: string; moved: boolean };

/** 卡片上能拖动整个节点的区域：标题行（问题）与上方的标签、附图；其余正文可以选中复制 */
const DRAG_HANDLE = ".card-q, .card-tag, .card-images";

function Edges() {
  const nodes = useGraph((s) => s.nodes);
  const pos = useGraph((s) => s.pos);
  const visible = useGraph((s) => s.visible);
  const activeId = useGraph((s) => s.activeId);
  const slot = useGraph((s) => s.slot);
  const focus = focusSets({ nodes, activeId });
  const vis = new Set(visible);
  return (
    <svg className="edges" aria-hidden="true">
      {visible.flatMap((id) => {
        const n = nodes[id];
        const dim = focus && !focus.lit.has(id);
        const out = [];
        // 路径写在 CSS d 属性上，才能和节点位移使用同一过渡
        if (n.parent && pos[n.parent]) {
          const on = focus?.path.has(id) && focus.path.has(n.parent);
          out.push(<path key={id} pathLength={1} className={`edge${on ? " on-path" : ""}${dim ? " dim" : ""}`} style={{ d: `path("${edgePath(pos[n.parent], pos[id])}")` }} />);
        }
        // 「换个方式再答一次」的对比节点：虚线连回原节点
        if (n.compareOf && vis.has(n.compareOf)) {
          out.push(<path key={`cmp-${id}`} className={`edge is-compare${dim ? " dim" : ""}`} style={{ d: `path("${edgePath(pos[n.compareOf], pos[id])}")` }} />);
        }
        for (const l of n.links) {
          if (vis.has(l)) out.push(<path key={`${l}-${id}`} className={`edge is-link${dim ? " dim" : ""}`} style={{ d: `path("${edgePath(pos[l], pos[id])}")` }} />);
        }
        return out;
      })}
      {slot && pos[slot.parent] && (
        <path key="slot" className="edge is-slot" style={{ d: `path("${edgePath(pos[slot.parent], slot.box)}")` }} />
      )}
    </svg>
  );
}

export function Canvas() {
  const view = useGraph((s) => s.view);
  const visible = useGraph((s) => s.visible);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // 触屏：记录所有触点，两指时进入捏合缩放
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: { x: number; y: number }; view: { x: number; y: number; s: number } } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"" | "is-panning" | "is-marquee" | "is-dragging">("");
  const worldRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // 拖动节点时悬停在另一个回答完成的节点上：松手就把它们连起来（弹出「想对它们做什么？」）
  const dropEl = useRef<HTMLElement | null>(null);
  const setDrop = (el: HTMLElement | null) => {
    if (dropEl.current === el) return;
    dropEl.current?.classList.remove("is-drop-target");
    el?.classList.add("is-drop-target");
    dropEl.current = el;
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  // 画布上的右键：节点上是复制与导出，空白处是新问题与导出整张地图（ContextMenu.tsx）；侧边栏等其他区域保留系统菜单
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest(".ctx-menu, .ctx-ask")) return;
    const { view: v } = useGraph.getState();
    const r = stageRef.current!.getBoundingClientRect();
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>(".node[data-id]");
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && nodeEl?.contains(sel.anchorNode) ? sel.toString() : "";
    setMenu({ x: e.clientX, y: e.clientY, wx: (e.clientX - r.left - v.x) / v.s, wy: (e.clientY - r.top - v.y) / v.s, nodeId: nodeEl?.dataset.id ?? null, text });
  };

  // 平移缩放过程中把整个画布提升为一个合成图层：GPU 直接平移、拉伸，帧率稳定（缩放时会略虚）；
  // 停下片刻后撤掉，浏览器按最终比例重新绘制，文字恢复清晰。直接改 class，不触发重新渲染
  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    el.classList.add("is-moving");
    const t = setTimeout(() => el.classList.remove("is-moving"), view.glide ? GLIDE_MS : SETTLE_MS);
    return () => clearTimeout(t);
  }, [view.x, view.y, view.s, view.glide]);

  // 滚轮缩放需要非被动监听才能阻止页面滚动
  useEffect(() => {
    const el = stageRef.current!;
    const zoom = createSmoothZoom();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 滚轮（含 Ctrl + 滚轮、触控板捏合）一律缩放；平移靠拖动空白处。
      // 每次事件的缩放幅度封顶约 12%，鼠标一格不会跳太多，触控板的小增量仍然连续；实际缩放由 createSmoothZoom 平滑过渡。
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);
      zoom.by(Math.exp(-Math.sign(px) * Math.min(Math.abs(px) * 0.01, 0.12)), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      zoom.stop();
    };
  }, []);

  const touchMid = () => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        // 第二根手指落下：放弃单指拖动，改为捏合
        drag.current = null;
        setMode("");
        setMarquee(null);
        const { view: v } = useGraph.getState();
        pinch.current = { ...touchMid(), view: { x: v.x, y: v.y, s: v.s } };
        stageRef.current!.setPointerCapture(e.pointerId);
        return;
      }
      if (touches.current.size > 2) return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-act], a")) return; // 卡片内按钮与链接自行处理点击
    if (target.closest(".ctx-menu, .ctx-ask")) return; // 右键菜单经 portal 渲染，React 事件仍会冒泡到这里
    const nodeEl = target.closest<HTMLElement>(".node");
    const { selected, nodes, view: v } = useGraph.getState();
    const card = target.closest(".card");
    if (nodeEl && e.button === 0 && card && !card.classList.contains("is-loading") && !target.closest(DRAG_HANDLE) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      drag.current = { type: "text", sx: e.clientX, sy: e.clientY, id: nodeEl.dataset.id!, moved: false };
      return;
    }
    if (nodeEl && e.button === 0) {
      const id = nodeEl.dataset.id!;
      const ids = selected.includes(id) ? selected : [id];
      drag.current = { type: "node", sx: e.clientX, sy: e.clientY, id, moved: false, orig: Object.fromEntries(ids.map((x) => [x, { dx: nodes[x].dx, dy: nodes[x].dy }])) };
    } else if (e.shiftKey && e.button === 0) {
      drag.current = { type: "marquee", sx: e.clientX, sy: e.clientY, base: selected, moved: false };
      setMode("is-marquee");
    } else {
      drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false };
    }
    stageRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && touches.current.size >= 2) {
        const { dist, mid } = touchMid();
        const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (p.view.s * dist) / p.dist));
        // 起始中点下的画布坐标跟随手指中点移动
        const wx = (p.mid.x - p.view.x) / p.view.s, wy = (p.mid.y - p.view.y) / p.view.s;
        setView({ s, x: mid.x - wx * s, y: mid.y - wy * s });
        return;
      }
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      if (d.type === "text") return;
      if (d.type === "pan") setMode("is-panning");
      if (d.type === "node") setMode("is-dragging");
    }
    const s = useGraph.getState();
    if (d.type === "text") return;
    if (d.type === "pan") {
      setView({ x: d.ox + dx, y: d.oy + dy });
    } else if (d.type === "node") {
      actions.moveNodes(d.orig, dx / s.view.s, dy / s.view.s);
      setDrop(dropTargetAt(e.clientX, e.clientY, d.orig));
    } else {
      const x = Math.min(e.clientX, d.sx), y = Math.min(e.clientY, d.sy), w = Math.abs(dx), h = Math.abs(dy);
      setMarquee({ x, y, w, h });
      const v = s.view;
      const r = { x1: (x - v.x) / v.s, y1: (y - v.y) / v.s, x2: (x + w - v.x) / v.s, y2: (y + h - v.y) / v.s };
      const hit = s.visible.filter((id) => {
        const b = s.pos[id];
        return s.nodes[id].kind === "answer" && b.x < r.x2 && b.x + b.w > r.x1 && b.y < r.y2 && b.y + b.h > r.y1;
      });
      actions.setSelected([...new Set([...d.base, ...hit])]);
    }
  };

  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        // 捏合结束后剩下的手指不再触发拖动或点击
        if (touches.current.size < 2) pinch.current = null;
        drag.current = null;
        return;
      }
    }
    const d = drag.current;
    drag.current = null;
    setMode("");
    setMarquee(null);
    const target = dropEl.current?.dataset.id;
    setDrop(null);
    if (d?.type === "node" && d.moved && target && !cancelled) {
      // 拖到别的节点上：节点回到原位，选中两边，交给「想对它们做什么？」
      actions.moveNodes(d.orig, 0, 0);
      const { nodes } = useGraph.getState();
      actions.setSelected([...new Set([...Object.keys(d.orig).filter((id) => isReady(nodes[id])), target])]);
      return;
    }
    if (!d || cancelled || d.type === "marquee" || d.moved) return;
    // 双击选词等选中了文字时不算点击
    if (d.type === "text" && window.getSelection()?.toString()) return;
    if (d.type === "pan") {
      if (useGraph.getState().selected.length) actions.setSelected([]);
      return;
    }
    onNodeClick(d.id, e);
  };

  return (
    <div
      ref={stageRef}
      className={`stage ${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
      onKeyDown={onCardKey}
      onContextMenu={onContextMenu}
      style={{
        backgroundSize: `${22 * view.s}px ${22 * view.s}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        ref={worldRef}
        className={`world${view.s < LOD_FAR ? " lod-far" : ""}${view.glide ? " glide" : ""}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
      >
        <Edges />
        {visible.map((id) => <NodeView key={id} id={id} />)}
        <AskSlot />
      </div>
      <Marquee rect={marquee} />
      <ContextMenu at={menu} onClose={closeMenu} />
    </div>
  );
}

type Rect = { x: number; y: number; w: number; h: number };

/** 框选框：松手后在原处淡出 */
function Marquee({ rect }: { rect: Rect | null }) {
  const p = usePresence(!!rect, 160);
  const last = useRef(rect);
  if (rect) last.current = rect;
  const r = last.current;
  if (!p.mounted || !r) return null;
  return <div className={`marquee${p.closing ? " is-closing" : ""}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
}

/** 指针下方另一个回答完成的节点（不含正在拖动的那些），没有就是 null */
function dropTargetAt(x: number, y: number, dragging: Record<string, unknown>): HTMLElement | null {
  const { nodes } = useGraph.getState();
  if (!Object.keys(dragging).some((id) => isReady(nodes[id]))) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const node = (el as HTMLElement).closest?.<HTMLElement>(".node[data-id]");
    const id = node?.dataset.id;
    if (id && !(id in dragging) && isReady(nodes[id])) return node;
  }
  return null;
}

function onNodeClick(id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  const { nodes, activeId, selected } = useGraph.getState();
  const n = nodes[id];
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    if (n.kind === "answer") actions.toggleSelected(id);
    return;
  }
  if (selected.length) actions.setSelected([]);
  if (n.kind === "question") return actions.ask(id);
  // 第一次点击：激活并展开要点；再次点击：打开详情
  if (id === activeId && n.status !== "loading") actions.openDrawer(id);
  else actions.activate(id);
}

function onCardKey(e: React.KeyboardEvent) {
  const card = (e.target as HTMLElement).closest(".card");
  if (!card || (e.key !== "Enter" && e.key !== " ")) return;
  if ((e.target as HTMLElement) !== card) return;
  e.preventDefault();
  onNodeClick(card.closest<HTMLElement>(".node")!.dataset.id!, e);
}

/** 当前路径（面包屑）：激活节点的祖先链 */
export function useCrumbs() {
  const nodes = useGraph((s) => s.nodes);
  const activeId = useGraph((s) => s.activeId);
  return activeId && nodes[activeId] ? chain(nodes, activeId) : [];
}

export const readySelected = () => {
  const { selected, nodes } = useGraph.getState();
  return selected.filter((id) => isReady(nodes[id]));
};
