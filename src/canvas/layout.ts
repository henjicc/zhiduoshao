import type { GNode } from "../store/types.ts";

export const COL_GAP = 72;
export const ROW_GAP = 16;
const DEFAULT = { answer: { w: 380, h: 140 }, question: { w: 380, h: 44 } };

/** head：回答节点里卡片上方问题行的高度，连线对齐卡片本身而不是问题行 */
export interface Box { x: number; y: number; w: number; h: number; head?: number }
export type Sizes = Record<string, { w: number; h: number; head?: number }>;
/** 延伸列表底部的输入框：不是节点，只占一个子位置 */
export const slotKey = (parent: string) => `ask:${parent}`;
const SLOT = { w: 380, h: 44 };
/** 问透的收尾记号（连线末端的实心点和一行小字）：也不是节点，排在子列最前面，后面照常是输入框。
 * 高度与延伸问题相同，连线落在同一高度；宽度只用来避让左右重叠，比文字略宽即可 */
export const endKey = (id: string) => `end:${id}`;
export const END = { w: 132, h: 44 };

/**
 * 从左到右的树形布局：每棵树的根以顶边固定在锚点，子节点与父节点顶边对齐、向下排开；拖动产生的偏移会带着整个子树移动。
 * 兄弟之间按实际占地紧凑排列：后一个兄弟的子树只需避开前面子树里与它左右重叠的节点，
 * 不再把整棵子树当成一个矩形——否则某个节点右侧的子节点列很长时，它下方会空出一大块（用户实测反馈）。
 * 顶部固定：节点流式输出变高时只向下长，上方的内容和来路不会被推动。
 * slotted：哪些节点在子节点最下方留出输入框的位置（不论输入框此刻是否显示，位置都先留好，出现和消失时布局不跳）。
 * 写了「追问：无」、没有子节点的节点（折叠的不算）在子列最前面留出收尾记号的位置。
 * spineId：主线（从根到这个节点的路径）拉成一条水平线：主线上的子节点与父节点顶边对齐，
 * 排在它前面的兄弟向上排开、后面的照旧向下，否则越往深处追问越往下滑（用户实测反馈）。
 * 对齐看的是卡片的顶边，不是节点的顶边：回答节点的卡片上方有问题行（Box.head），各节点问题行的行数不同，
 * 按节点顶边对齐会让卡片和连线上下错开。所以排布时纵向坐标都以卡片顶边为准，只有根的锚点 ay 仍是节点左上角。
 */
export function layout(nodes: Record<string, GNode>, sizes: Sizes, slotted: ((n: GNode) => boolean) | null = null, spineId: string | null = null): { pos: Record<string, Box>; visible: string[]; slots: Record<string, Box>; ends: Record<string, Box> } {
  const pos: Record<string, Box> = {};
  const visible: string[] = [];
  const slots: Record<string, Box> = {};
  const ends: Record<string, Box> = {};
  const slotSize = (n: GNode) => (slotted?.(n) && !n.collapsed ? sizes[slotKey(n.id)] ?? SLOT : null);
  const endSize = (n: GNode) => (n.settled && !n.collapsed && !n.children.length ? END : null);
  const size = (n: GNode) => sizes[n.id] ?? DEFAULT[n.kind];
  const headOf = (n: GNode) => size(n).head ?? 0;
  const kids = (n: GNode) => (n.collapsed ? [] : n.children.map((id) => nodes[id]).filter(Boolean));
  /** 子节点（与输入框）相对父节点子列顶边的纵向位置 */
  const offset = new Map<string, number>();
  const spine = new Set<string>();
  for (let n = spineId ? nodes[spineId] : undefined; n; n = n.parent ? nodes[n.parent] : undefined) spine.add(n.id);
  const overlapsX = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;

  /** 子树占地：节点自己与全部后代的矩形，坐标相对子树根卡片的左上角（问题行和主线前的兄弟在它上方，y 为负） */
  const measure = (n: GNode): Box[] => {
    const { w, h } = size(n);
    const own: Box[] = [{ x: 0, y: -headOf(n), w, h }];
    const col = w + COL_GAP;
    const placed: Box[] = [];
    const commit = (key: string, boxes: Box[], y: number) => {
      offset.set(key, y);
      for (const b of boxes) placed.push({ ...b, y: b.y + y });
    };
    /** 子树根不动，只把它右边的子列（含收尾记号与输入框）整体挪 d：节点本身可以贴着上面的兄弟，子列另外找空位 */
    const shiftKids = (c: GNode, boxes: Box[], d: number) => {
      for (const k of kids(c)) offset.set(k.id, offset.get(k.id)! + d);
      for (const key of [endSize(c) && endKey(c.id), slotSize(c) && slotKey(c.id)]) if (key) offset.set(key, offset.get(key)! + d);
      return boxes.map((b, i) => (i === 0 ? b : { ...b, y: b.y + d }));
    };
    let floor = 0;
    const below = (key: string, boxes: Box[], c?: GNode) => {
      // 不早于前一个兄弟。是子树时只让它自己的卡片避开已放下的矩形，贴着上面放；
      // 它的子列要是和左右重叠的矩形撞上，就单独往下挪，而不是把整棵子树连同这张卡片一起推远（用户反馈：
      // 上一个兄弟右边的子列很长时，这张卡片被推到很远的下方，中间空出一大块）
      let y = floor;
      const own = c ? boxes.slice(0, 1) : boxes;
      for (const b of own) for (const p of placed) if (overlapsX(b, p)) y = Math.max(y, p.y + p.h + ROW_GAP - b.y);
      if (c && boxes.length > 1) {
        let d = 0;
        for (const b of boxes.slice(1)) for (const p of placed) if (overlapsX(b, p)) d = Math.max(d, p.y + p.h + ROW_GAP - b.y - y);
        if (d > 0) boxes = shiftKids(c, boxes, d);
      }
      commit(key, boxes, (floor = y));
    };
    let ceil = 0;
    const above = (key: string, boxes: Box[], c: GNode) => {
      // 镜像：不晚于后一个兄弟，卡片底边避开已放下的、左右有重叠的矩形；子列撞上时单独往上挪
      let y = ceil;
      const b0 = boxes[0];
      for (const p of placed) if (overlapsX(b0, p)) y = Math.min(y, p.y - ROW_GAP - b0.y - b0.h);
      let d = 0;
      for (const b of boxes.slice(1)) for (const p of placed) if (overlapsX(b, p)) d = Math.min(d, p.y - ROW_GAP - b.y - b.h - y);
      if (d < 0) boxes = shiftKids(c, boxes, d);
      commit(key, boxes, (ceil = y));
    };
    const cs = kids(n);
    const k = Math.max(0, cs.findIndex((c) => spine.has(c.id)));
    const sub = cs.map(measure);
    // 主线子节点先放在 0；前面的兄弟只需避开它，后面的兄弟避开全部，上方兄弟垂下来的子列也不会被压住
    if (cs.length) below(cs[k].id, sub[k], cs[k]);
    for (let i = k - 1; i >= 0; i--) above(cs[i].id, sub[i], cs[i]);
    for (let i = k + 1; i < cs.length; i++) below(cs[i].id, sub[i], cs[i]);
    const es = endSize(n);
    if (es) below(endKey(n.id), [{ x: 0, y: 0, ...es }]);
    const ss = slotSize(n);
    if (ss) below(slotKey(n.id), [{ x: 0, y: 0, w: ss.w, h: ss.h }]);
    return [...own, ...placed.map((b) => ({ ...b, x: b.x + col }))];
  };

  /** top：这个节点卡片顶边的纵坐标 */
  const place = (n: GNode, x: number, top: number, ox: number, oy: number) => {
    ox += n.dx;
    oy += n.dy;
    const { w, h, head } = size(n);
    pos[n.id] = { x: x + ox, y: top - headOf(n) + oy, w, h, ...(head ? { head } : {}) };
    visible.push(n.id);
    for (const c of kids(n)) place(c, x + w + COL_GAP, top + offset.get(c.id)!, ox, oy);
    const es = endSize(n);
    if (es) ends[n.id] = { x: x + w + COL_GAP + ox, y: top + offset.get(endKey(n.id))! + oy, ...es };
    const ss = slotSize(n);
    if (ss) slots[n.id] = { x: x + w + COL_GAP + ox, y: top + offset.get(slotKey(n.id))! + oy, w: ss.w, h: ss.h };
  };

  for (const n of Object.values(nodes)) {
    if (n.parent) continue;
    measure(n);
    place(n, n.ax, n.ay + headOf(n), 0, 0);
  }
  return { pos, visible, slots, ends };
}

export function bounds(boxes: Box[]) {
  return {
    x1: Math.min(...boxes.map((b) => b.x)),
    y1: Math.min(...boxes.map((b) => b.y)),
    x2: Math.max(...boxes.map((b) => b.x + b.w)),
    y2: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

/** 连线从父节点卡片第一行的高度引出（顶部固定布局下，父卡片再长也不影响连线起点），连到子节点卡片第一行或竖直中心
 * （2026-10 试过从父节点竖直中间引出，用户看过后改回）；卡片上方的问题行不算，见 Box.head */
const EDGE_TOP = 27;
const anchorY = (b: Box) => {
  const head = b.head ?? 0;
  return b.y + head + Math.min((b.h - head) / 2, EDGE_TOP);
};
export function edgePath(a: Box, b: Box) {
  const x1 = a.x + a.w, y1 = anchorY(a), x2 = b.x, y2 = anchorY(b);
  const d = Math.max(28, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
}
