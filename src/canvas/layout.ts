import type { GNode } from "../store/types.ts";

export const COL_GAP = 72;
export const ROW_GAP = 16;
const DEFAULT = { answer: { w: 380, h: 140 }, question: { w: 260, h: 44 } };

export interface Box { x: number; y: number; w: number; h: number }
export type Sizes = Record<string, { w: number; h: number }>;
/** 延伸列表底部的输入框：不是节点，只占一个子位置 */
export interface Slot { parent: string; box: Box }
export const slotKey = (parent: string) => `ask:${parent}`;
const SLOT = { w: 260, h: 44 };

/**
 * 从左到右的树形布局：每棵树的根以顶边固定在锚点，子节点与父节点顶边对齐、向下排开；拖动产生的偏移会带着整个子树移动。
 * 兄弟之间按实际占地紧凑排列：后一个兄弟的子树只需避开前面子树里与它左右重叠的节点，
 * 不再把整棵子树当成一个矩形——否则某个节点右侧的子节点列很长时，它下方会空出一大块（用户实测反馈）。
 * 顶部固定：节点流式输出变高时只向下长，上方的内容和来路不会被推动。
 * slotFor：在这个节点的子节点最下方留出输入框的位置。
 * spineId：主线（从根到这个节点的路径）拉成一条水平线：主线上的子节点与父节点顶边对齐，
 * 排在它前面的兄弟向上排开、后面的照旧向下，否则越往深处追问越往下滑（用户实测反馈）。
 */
export function layout(nodes: Record<string, GNode>, sizes: Sizes, slotFor: string | null = null, spineId: string | null = null) {
  const pos: Record<string, Box> = {};
  const visible: string[] = [];
  let slot: Slot | null = null;
  const slotSize = (n: GNode) => (n.id === slotFor && !n.collapsed ? sizes[slotKey(n.id)] ?? SLOT : null);
  const size = (n: GNode) => sizes[n.id] ?? DEFAULT[n.kind];
  const kids = (n: GNode) => (n.collapsed ? [] : n.children.map((id) => nodes[id]).filter(Boolean));
  /** 子节点（与输入框）相对父节点子列顶边的纵向位置 */
  const offset = new Map<string, number>();
  const spine = new Set<string>();
  for (let n = spineId ? nodes[spineId] : undefined; n; n = n.parent ? nodes[n.parent] : undefined) spine.add(n.id);
  const overlapsX = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;

  /** 子树占地：节点自己与全部后代的矩形，坐标相对子树根的左上角（主线前的兄弟会排到根的上方，y 为负） */
  const measure = (n: GNode): Box[] => {
    const { w, h } = size(n);
    const own: Box[] = [{ x: 0, y: 0, w, h }];
    const col = w + COL_GAP;
    const placed: Box[] = [];
    const commit = (key: string, boxes: Box[], y: number) => {
      offset.set(key, y);
      for (const b of boxes) placed.push({ ...b, y: b.y + y });
    };
    let floor = 0;
    const below = (key: string, boxes: Box[]) => {
      // 不早于前一个兄弟，且避开已放下的、左右有重叠的矩形
      let y = floor;
      for (const b of boxes) for (const p of placed) if (overlapsX(b, p)) y = Math.max(y, p.y + p.h + ROW_GAP - b.y);
      commit(key, boxes, (floor = y));
    };
    let ceil = 0;
    const above = (key: string, boxes: Box[]) => {
      // 镜像：不晚于后一个兄弟，底边避开已放下的、左右有重叠的矩形
      let y = ceil;
      for (const b of boxes) for (const p of placed) if (overlapsX(b, p)) y = Math.min(y, p.y - ROW_GAP - b.y - b.h);
      commit(key, boxes, (ceil = y));
    };
    const cs = kids(n);
    const k = Math.max(0, cs.findIndex((c) => spine.has(c.id)));
    const sub = cs.map(measure);
    // 主线子节点先放在 0；前面的兄弟只需避开它，后面的兄弟避开全部，上方兄弟垂下来的子列也不会被压住
    if (cs.length) below(cs[k].id, sub[k]);
    for (let i = k - 1; i >= 0; i--) above(cs[i].id, sub[i]);
    for (let i = k + 1; i < cs.length; i++) below(cs[i].id, sub[i]);
    const ss = slotSize(n);
    if (ss) below(slotKey(n.id), [{ x: 0, y: 0, w: ss.w, h: ss.h }]);
    return [...own, ...placed.map((b) => ({ ...b, x: b.x + col }))];
  };

  const place = (n: GNode, x: number, top: number, ox: number, oy: number) => {
    ox += n.dx;
    oy += n.dy;
    const { w, h } = size(n);
    pos[n.id] = { x: x + ox, y: top + oy, w, h };
    visible.push(n.id);
    for (const c of kids(n)) place(c, x + w + COL_GAP, top + offset.get(c.id)!, ox, oy);
    const ss = slotSize(n);
    if (ss) slot = { parent: n.id, box: { x: x + w + COL_GAP + ox, y: top + offset.get(slotKey(n.id))! + oy, w: ss.w, h: ss.h } };
  };

  for (const n of Object.values(nodes)) {
    if (n.parent) continue;
    measure(n);
    place(n, n.ax, n.ay, 0, 0);
  }
  return { pos, visible, slot };
}

export function bounds(boxes: Box[]) {
  return {
    x1: Math.min(...boxes.map((b) => b.x)),
    y1: Math.min(...boxes.map((b) => b.y)),
    x2: Math.max(...boxes.map((b) => b.x + b.w)),
    y2: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

/** 连线从父节点标题行的高度引出（顶部固定布局下，父卡片再长也不影响连线起点），连到子节点竖直中心 */
const EDGE_TOP = 27;
export function edgePath(a: Box, b: Box) {
  const x1 = a.x + a.w, y1 = a.y + Math.min(a.h / 2, EDGE_TOP), x2 = b.x, y2 = b.y + Math.min(b.h / 2, EDGE_TOP);
  const d = Math.max(28, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
}
