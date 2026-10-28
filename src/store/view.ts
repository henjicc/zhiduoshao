import { bounds, COL_GAP } from "../canvas/layout.ts";
import { clampDrawer, useSettings } from "../settings/store.ts";
import { commitNodes, focusOf, get, set, type View } from "./core.ts";

// 视角与焦点：缩放、平移、让节点进入视野、切换当前节点。

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 1.8;
const TOPBAR_H = 52;
const NARROW = 720;

/** 画布上可用于摆放节点的屏幕区域（去掉顶栏、详情抽屉与底部缩放条） */
export function viewport() {
  const { drawerId } = get();
  const drawer = drawerId && innerWidth > NARROW ? clampDrawer(useSettings.getState().drawerWidth) : 0;
  return { l: 24, t: TOPBAR_H + 24, r: innerWidth - drawer - 24, b: innerHeight - 72 };
}

/** 新地图的初始视角：第一张卡片的顶边放在可用区域上部，内容向下长 */
export function startView(): View {
  const t = TOPBAR_H + 24, b = innerHeight - 72;
  return { x: Math.max(32, innerWidth * 0.1), y: Math.round(t + (b - t) * 0.14), s: 1, glide: false };
}

/**
 * 用户自己最后一次平移、缩放画布的时间，和最后一次切换当前节点的时间。回答完成时的自动入镜（revealBranch 的 auto）
 * 在用户切换节点之后动过画布就不再执行：不然一边输出一边拖画布，答完那一下会把视角强行拽回去（用户反馈）
 */
let userMovedAt = 0;
let focusedAt = 0;

export function setView(v: Partial<View>) {
  userMovedAt = Date.now();
  set({ view: { ...get().view, glide: false, ...v } });
}

export function zoomAt(factor: number, cx: number, cy: number, glide = false) {
  userMovedAt = Date.now();
  const v = get().view;
  const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.s * factor));
  set({ view: { s, x: cx - ((cx - v.x) * s) / v.s, y: cy - ((cy - v.y) * s) / v.s, glide } });
}

export function fit() {
  const { pos, visible, ends } = get();
  if (!visible.length) return;
  const b = bounds([...visible.map((id) => pos[id]), ...Object.values(ends)]);
  const vp = viewport();
  const s = Math.min(1, Math.max(ZOOM_MIN, Math.min((vp.r - vp.l) / (b.x2 - b.x1), (vp.b - vp.t) / (b.y2 - b.y1))));
  set({ view: { s, x: (vp.l + vp.r) / 2 - ((b.x1 + b.x2) / 2) * s, y: (vp.t + vp.b) / 2 - ((b.y1 + b.y2) / 2) * s, glide: true } });
}

/** 这些节点在屏幕上占的范围，连同它们的收尾记号 */
function screenBounds(ids: string[]) {
  const { pos, ends, view: v } = get();
  const boxes = ids.flatMap((id) => [pos[id], ends[id]]).filter(Boolean);
  if (!boxes.length) return null;
  const b = bounds(boxes);
  return { x1: b.x1 * v.s + v.x, x2: b.x2 * v.s + v.x, y1: b.y1 * v.s + v.y, y2: b.y2 * v.s + v.y };
}

const fitsViewport = (ids: string[]) => {
  const b = screenBounds(ids), vp = viewport();
  return !!b && b.x2 - b.x1 <= vp.r - vp.l && b.y2 - b.y1 <= vp.b - vp.t;
};

/** 平移最小距离让这些节点进入视野；放不下时对齐左上 */
function reveal(ids: string[]) {
  const b = screenBounds(ids);
  if (!b) return;
  const vp = viewport(), v = get().view;
  let dx = 0, dy = 0;
  if (b.x2 - b.x1 > vp.r - vp.l || b.x1 < vp.l) dx = vp.l - b.x1; else if (b.x2 > vp.r) dx = vp.r - b.x2;
  if (b.y2 - b.y1 > vp.b - vp.t || b.y1 < vp.t) dy = vp.t - b.y1; else if (b.y2 > vp.b) dy = vp.b - b.y2;
  if (dx || dy) set({ view: { ...v, x: v.x + dx, y: v.y + dy, glide: true } });
}

/**
 * 等新内容完成测量后再调整视野：优先连父节点一起保留在屏幕内，保持来路可见。
 * auto：回答完成时自动触发的，用户在切换到这个节点之后自己动过画布就不调整
 */
export function revealBranch(id: string, auto = false) {
  if (!auto) focusedAt = Date.now();
  setTimeout(() => {
    if (auto && userMovedAt > focusedAt) return;
    const n = get().nodes[id];
    if (!n) return;
    const branch = [id, ...(n.collapsed ? [] : n.children)];
    const withParent = n.parent ? [n.parent, ...branch] : branch;
    reveal(fitsViewport(withParent) ? withParent : branch);
  }, 80);
}

/** 切换当前节点：详情抽屉开着时跟着切换，并让这条分支进入视野 */
export function activate(id: string) {
  const { drawerId } = get();
  // 侧边栏开着时跟着切到新节点的详情，退出正在阅读的来源
  commitNodes(get().nodes, { ...focusOf(id), ...(drawerId ? { drawerId: id, reading: null } : {}) });
  revealBranch(id);
}

/** 右键空白处新起的问题：从点击位置开始，压住已有节点就移到它们下方 */
export function freeAt(x: number, y: number) {
  const { pos, visible } = get();
  const W = 380, H = 160, PAD = 24;
  for (let i = 0; i < 50; i++) {
    const hit = visible.map((id) => pos[id]).filter((b) => b.x < x + W + PAD && b.x + b.w > x - PAD && b.y < y + H + PAD && b.y + b.h > y - PAD);
    if (!hit.length) break;
    y = Math.max(...hit.map((b) => b.y + b.h)) + PAD * 2;
  }
  return { ax: x, ay: y };
}

/** 为综合节点找一个不压住已有节点的位置：从所选节点右侧开始，被挡就继续向右 */
export function freeSpot(linked: string[]) {
  const { pos, visible } = get();
  const W = 380, H = 220, PAD = 24;
  let x = Math.max(...linked.map((id) => pos[id].x + pos[id].w)) + COL_GAP * 1.4;
  const cy = linked.reduce((s, id) => s + pos[id].y + pos[id].h / 2, 0) / linked.length;
  for (let i = 0; i < 50; i++) {
    const hit = visible.map((id) => pos[id]).filter((b) =>
      b.x < x + W + PAD && b.x + b.w > x - PAD && b.y < cy + H / 2 + PAD && b.y + b.h > cy - H / 2 - PAD);
    if (!hit.length) break;
    x = Math.max(...hit.map((b) => b.x + b.w)) + COL_GAP;
  }
  return { ax: x, ay: cy - H / 2 };
}
