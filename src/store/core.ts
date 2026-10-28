import { create } from "zustand";
import type { NodeContext } from "../core/protocol.ts";
import { layout, type Box, type Sizes, type Slot } from "../canvas/layout.ts";
import { maxSeq } from "../history/snapshot.ts";
import type { GNode } from "./types.ts";

// 画布状态的唯一来源与节点读写的基础操作。视角与焦点在 view.ts，请求编排在 runs.ts，界面调用的操作在 graph.ts。

export interface View { x: number; y: number; s: number; glide: boolean }
/** 当前地图在历史记录里的身份；自动保存见 history/store.ts */
export interface MapInfo { id: string; createdAt: number; updatedAt: number }

export interface GraphState {
  screen: "home" | "workspace";
  map: MapInfo | null;
  nodes: Record<string, GNode>;
  sizes: Sizes;
  pos: Record<string, Box>;
  visible: string[];
  /** 当前节点延伸列表底部的输入框位置 */
  slot: Slot | null;
  /** 问透的节点连线末端的收尾记号位置，键为节点 id */
  ends: Record<string, Box>;
  /** 输入框正在等模型判断意图 */
  slotBusy: boolean;
  activeId: string | null;
  /** 主线终点：从根到它的路径排成水平线（layout 的 spineId）。只在提问时切换，单纯点选浏览不切换，免得画布跟着晃 */
  spineId: string | null;
  /** 激活过的节点；设置为「保持展开」时它们的要点一直显示。只在本次打开地图期间有效，不存档 */
  opened: Record<string, true>;
  selected: string[];
  drawerId: string | null;
  /** 侧边栏里正在阅读的来源（节点 id 与来源 id）；为 null 时侧边栏显示节点详情。
   * 按 id 而不是序号定位：回答过程中复查会剔除来源，序号会变 */
  reading: { nodeId: string; sourceId: string } | null;
  summaryOpen: boolean;
  search: boolean;
  view: View;
  /** 离开正在回答的地图前的确认：还有几个节点在进行，以及确认后要做的事 */
  leaving: { count: number; next: () => void } | null;
}

export const initial = (): Omit<GraphState, "search" | "screen" | "map"> => ({
  nodes: {},
  sizes: {},
  pos: {},
  visible: [],
  slot: null,
  ends: {},
  slotBusy: false,
  activeId: null,
  spineId: null,
  opened: {},
  selected: [],
  drawerId: null,
  reading: null,
  summaryOpen: false,
  view: { x: 0, y: 0, s: 1, glide: false },
  leaving: null,
});

export const useGraph = create<GraphState>(() => ({ screen: "home", map: null, search: true, ...initial() }));

export const get = useGraph.getState;
export const set = useGraph.setState;

/** 节点 id 形如 n12：新地图从 0 开始，打开存档时接着最大编号 */
let seq = 0;
export const resetSeq = (n = 0) => { seq = n; };

/** 输入框跟着当前节点：已完成的回答节点才有（加载中、出错、未回答的问题都不显示） */
export const slotParent = (nodes: Record<string, GNode>, activeId: string | null | undefined) =>
  activeId && nodes[activeId]?.kind === "answer" && nodes[activeId].status === "ready" ? activeId : null;

/** 写入节点并重新布局；extra 里带了 activeId 时按新的当前节点放输入框 */
export function commitNodes(nodes: Record<string, GNode>, extra: Partial<GraphState> = {}) {
  const activeId = "activeId" in extra ? extra.activeId : get().activeId;
  const spineId = "spineId" in extra ? extra.spineId : get().spineId;
  const { pos, visible, slot, ends } = layout(nodes, extra.sizes ?? get().sizes, slotParent(nodes, activeId), spineId ?? null);
  set({ nodes, pos, visible, slot, ends, ...extra });
}

/**
 * 把主线切到这个节点。重新排列后它所在那棵树整体平移（改根节点锚点），让它留在原处：
 * 看起来是来路和兄弟让开，而不是画布跳走
 */
export function setSpine(id: string) {
  const { nodes, pos, sizes, activeId } = get();
  if (!nodes[id] || get().spineId === id) return;
  const before = pos[id];
  const after = layout(nodes, sizes, slotParent(nodes, activeId), id).pos[id];
  const root = chain(nodes, id)[0];
  const dy = before && after ? after.y - before.y : 0;
  commitNodes(dy ? { ...nodes, [root.id]: { ...root, ay: root.ay - dy } } : nodes, { spineId: id });
}

/** 打开地图时的主线：最近回答完成的节点（综合节点自成一棵树，不算） */
export function latestAnswered(nodes: Record<string, GNode>) {
  let best: GNode | null = null;
  for (const n of Object.values(nodes)) if (!n.links.length && n.answeredAt > (best?.answeredAt ?? 0)) best = n;
  return best?.id ?? null;
}

/** 激活节点时同时记入 opened */
export const focusOf = (id: string) => ({ activeId: id, opened: get().opened[id] ? get().opened : { ...get().opened, [id]: true as const } });

export function patch(id: string, fn: (n: GNode) => Partial<GNode>) {
  const n = get().nodes[id];
  if (!n) return;
  commitNodes({ ...get().nodes, [id]: { ...n, ...fn(n) } });
}

export function newNode(p: Partial<GNode> & Pick<GNode, "kind" | "q">): GNode {
  return {
    id: "n" + ++seq,
    dir: null, nextWhy: null, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
    status: "idle", stage: null, stageDetail: null, images: [], imageNote: "", summary: "", framed: false, thinking: "", points: [], visual: null, memory: null, sources: [], queries: [], searchResults: 0, searches: [], steps: [], dropped: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null, detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null,
    dx: 0, dy: 0, ax: 0, ay: 0,
    ...p,
  };
}

/* ============ 后台地图 ============ */

/** 离开时选择「在后台继续」的地图：还在进行的回答继续写到这里，全部完成后存档并移除；再次打开时接着用这份 */
export interface Parked { map: MapInfo; nodes: Record<string, GNode>; view: View; opened: Record<string, true> }
export const parked = new Map<string, Parked>();
/** 后台地图的 id，供首页与历史列表显示「后台回答中」 */
export const useParked = create<{ ids: string[] }>(() => ({ ids: [] }));
const syncParked = () => useParked.setState({ ids: [...parked.keys()] });

/** 后台地图有写入（done 为 false）或全部完成（done 为 true）时通知存档，见 history/store.ts */
let parkedListener: (mapId: string, done: boolean) => void = () => {};
export const onParkedChange = (fn: typeof parkedListener) => { parkedListener = fn; };

export function park(p: Parked) {
  parked.set(p.map.id, p);
  syncParked();
}
export function unpark(mapId: string) {
  const p = parked.get(mapId);
  parked.delete(mapId);
  syncParked();
  return p;
}
export const parkedDone = (mapId: string) => parked.has(mapId) && parkedListener(mapId, true);

/** 某张地图的节点：打开着的在画布状态里，后台的在 parked 里，都不在（已关闭）时为 null */
export const nodesOf = (mapId: string) => (get().map?.id === mapId ? get().nodes : parked.get(mapId)?.nodes ?? null);

function writeNodes(mapId: string, nodes: Record<string, GNode>) {
  if (get().map?.id === mapId) return commitNodes(nodes);
  const p = parked.get(mapId);
  if (!p) return;
  p.nodes = nodes;
  parkedListener(mapId, false);
}

/** 按地图写节点：请求的结果写回发起它的那张地图，不管它现在是否打开 */
export function patchAt(mapId: string, id: string, fn: (n: GNode) => Partial<GNode>) {
  const nodes = nodesOf(mapId);
  const n = nodes?.[id];
  if (!nodes || !n) return;
  writeNodes(mapId, { ...nodes, [id]: { ...n, ...fn(n) } });
}

export function addAt(mapId: string, p: Partial<GNode> & Pick<GNode, "kind" | "q">) {
  const nodes = nodesOf(mapId);
  if (!nodes) return;
  // 后台地图不能用当前地图的编号序列，接着它自己的最大编号
  const n = get().map?.id === mapId ? newNode(p) : newNode({ ...p, id: `n${maxSeq(nodes) + 1}` });
  writeNodes(mapId, withChild(nodes, n));
}

function withChild(nodes: Record<string, GNode>, n: GNode) {
  const out = { ...nodes, [n.id]: n };
  if (n.parent && out[n.parent]) out[n.parent] = { ...out[n.parent], children: [...out[n.parent].children, n.id] };
  return out;
}

export function addNode(n: GNode) {
  commitNodes(withChild(get().nodes, n));
  return n.id;
}

/** 从根到这个节点的链 */
export const chain = (nodes: Record<string, GNode>, id: string) => {
  const out: GNode[] = [];
  for (let n: GNode | undefined = nodes[id]; n; n = n.parent ? nodes[n.parent] : undefined) out.unshift(n);
  return out;
};

export const isReady = (n: GNode | undefined): n is GNode => !!n && n.kind === "answer" && n.status === "ready";
export const stripCites = (s: string) => s.replace(/\[\d+\]/g, "");

const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** 回答后至少过这么久才提供「看看新进展」，刚回答完再查没有意义 */
const NEWS_AFTER = 3_600_000;

/**
 * 「看看新进展」从哪天查起：联网回答过的普通节点取回答完成那天；早期存档没有回答时间，取最新来源的发布日期。
 * 综合节点、没有来源、刚回答完的节点不提供，返回 null。
 */
export function newsSince(n: GNode, now = Date.now()): string | null {
  if (!isReady(n) || n.links.length || !n.sources.length) return null;
  if (n.answeredAt) return now - n.answeredAt >= NEWS_AFTER ? ymd(n.answeredAt) : null;
  const latest = Math.max(...n.sources.map((s) => (s.date ? Date.parse(s.date) : NaN)).filter((t) => !Number.isNaN(t)));
  return Number.isFinite(latest) ? ymd(latest) : null;
}

export function toContext(n: GNode): NodeContext {
  return { q: n.q, summary: stripCites(n.summary), points: n.points, sources: n.sources };
}

/** 探索路径：从根到上一层里已完成的节点，交给模型理解追问语境 */
export function pathOf(id: string) {
  return chain(get().nodes, id).slice(0, -1).filter(isReady).map((n) => ({ q: n.q, summary: stripCites(n.summary) }));
}

/** 延伸问题去重用的「已有问题」：只取相关的部分（路径上的节点、它们的直接子问题、来源节点及其子问题），
 * 不把整张画布塞给模型 */
const MAX_EXISTING = 20;
export function relatedQuestions(ids: string[]) {
  const { nodes } = get();
  const out = new Set<string>();
  for (const id of ids) {
    for (const a of chain(nodes, id)) {
      out.add(a.q);
      for (const c of a.children) if (nodes[c]) out.add(nodes[c].q);
    }
  }
  return [...out].slice(-MAX_EXISTING);
}
