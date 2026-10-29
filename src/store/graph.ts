import type { OpKind } from "../core/protocol.ts";
import { layout } from "../canvas/layout.ts";
import { maxSeq, restoreNodes, rootOf, type MapRecord } from "../history/snapshot.ts";
import { addNode, chain, commitNodes, setSize, focusOf, get, initial, isReady, latestAnswered, newNode, newsSince, park, parked, patch, resetSeq, set, setSpine, slotParent, unpark } from "./core.ts";
import { cancelMap, isDetailRunning, runAnswer, runCommand, runDetail, runningCount, runSynthesis } from "./runs.ts";
import { activate, freeAt, freeSpot, revealBranch, startView } from "./view.ts";
import { recordAngle, recordSite } from "../memory/store.ts";
import { openExternal } from "../lib/external.ts";
import { useSettings } from "../settings/store.ts";
import { reportAction } from "@henjicc/web-replay-probe";

// 画布对界面的入口：状态读取与界面触发的操作。状态与节点基础操作在 core.ts，视角在 view.ts，请求编排在 runs.ts。

export { chain, isReady, newsSince, toContext, useGraph, useParked, type MapInfo, type View } from "./core.ts";
export { fit, setView, viewport, zoomAt, ZOOM_MAX, ZOOM_MIN } from "./view.ts";

/**
 * 点选节点时的主线：点的是当前主线上的节点（比如从面包屑或画布点回前面的节点），保持现在的对齐不变，
 * 路径本来就在一条线上，换主线反而会把后面的节点打乱（用户反馈）；点的是主线以外的节点才切过去
 */
function followSpine(id: string) {
  const { nodes, spineId } = get();
  if (spineId && nodes[spineId] && chain(nodes, spineId).some((n) => n.id === id)) return;
  setSpine(id);
}

/** 要回答的问题在折叠的分支里（追问、看看新进展，或在侧边栏、总结面板里点的）：先展开它上面折叠的节点，回答才看得见 */
function expandTo(id: string) {
  const { nodes } = get();
  const folded = chain(nodes, id).slice(0, -1).filter((a) => a.collapsed);
  if (folded.length) commitNodes({ ...nodes, ...Object.fromEntries(folded.map((a) => [a.id, { ...a, collapsed: false }])) });
}

/** 离开地图时取消它的请求；已选择在后台继续的地图除外 */
function cancelCurrent() {
  const id = get().map?.id;
  if (id && !parked.has(id)) cancelMap(id);
}

/** 按选择离开：终止就取消请求；在后台继续就把地图交给后台（输入框的意图判断随之取消） */
function leaveWith(choice: "stop" | "background", next: () => void) {
  const { map, nodes, view, opened } = get();
  if (map && choice === "background") {
    cancelMap(map.id, "command");
    // 确认弹窗开着时可能已经答完：没有进行中的请求就不进后台（否则没有结束事件来移出），照常自动保存
    if (runningCount(map.id)) park({ map: { ...map }, nodes, view, opened });
  }
  next();
}

export const actions = {
  start(question: string, images: string[] = []) {
    cancelCurrent();
    resetSeq();
    const now = Date.now();
    set({ ...initial(), screen: "workspace", map: { id: crypto.randomUUID(), createdAt: now, updatedAt: now }, view: startView() });
    const id = addNode(newNode({ kind: "answer", q: question, images }));
    commitNodes(get().nodes, focusOf(id));
    runAnswer(id);
  },

  /**
   * 换个方式再答一次、并排对比：原节点联网答的就不联网再答，反之联网再答。新节点放在原节点右侧的空位，
   * 固定这次的联网方式（不跟随顶栏开关），用虚线连回原节点
   */
  compare(id: string) {
    const n = get().nodes[id];
    if (!isReady(n)) return;
    const mode = n.sources.length ? "off" : "on";
    const cid = addNode(newNode({ kind: "answer", q: n.q, images: n.images, imageNote: n.imageNote, searchMode: mode, compareOf: id, ...freeSpot([id]) }));
    commitNodes(get().nodes, { ...focusOf(cid), spineId: cid });
    runAnswer(cid);
  },

  /** 在当前地图里另起一个问题（右键空白处）：新的根节点放在点击的位置，方便和已有的树对比 */
  startHere(question: string, ax: number, ay: number) {
    const id = addNode(newNode({ kind: "answer", q: question, ...freeAt(ax, ay) }));
    commitNodes(get().nodes, { ...focusOf(id), spineId: id });
    runAnswer(id);
  },

  /** 打开历史记录里的地图，回到上次离开时的视角 */
  openMap(r: MapRecord) {
    cancelCurrent();
    // 还在后台回答的地图：接着用内存里的最新状态，进行中的请求会继续写回来
    const live = unpark(r.id);
    const nodes = live ? live.nodes : restoreNodes(r.nodes, r.anchor !== "top");
    resetSeq(maxSeq(nodes));
    const root = rootOf(nodes);
    const spineId = latestAnswered(nodes);
    const { pos, visible, slot, ends } = layout(nodes, {}, slotParent(nodes, root?.id), spineId);
    set({
      ...initial(), screen: "workspace", map: { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt },
      nodes, pos, visible, slot, ends, activeId: root?.id ?? null, spineId, view: { ...(live?.view ?? r.view), glide: false },
      // 激活过的节点随存档保存，「保持展开」时重新打开仍是展开的
      opened: { ...(live?.opened ?? Object.fromEntries((r.opened ?? []).filter((id) => nodes[id]).map((id) => [id, true as const]))), ...(root ? { [root.id]: true as const } : {}) },
    });
  },

  goHome() {
    cancelCurrent();
    set({ ...initial(), screen: "home", map: null });
  },

  /**
   * 离开当前地图（回首页、打开别的地图）：还有节点在回答时，按设置终止或留在后台继续；
   * 设置为「每次询问」时先弹出确认，由 resolveLeave 接着处理
   */
  leave(next: () => void) {
    const count = get().screen === "workspace" ? runningCount() : 0;
    if (!count) return next();
    const pref = useSettings.getState().onLeave;
    if (pref === "ask") return set({ leaving: { count, next } });
    leaveWith(pref, next);
  },

  /** 确认框的选择：null 为取消、留在当前地图；remember 时写入设置，以后不再询问 */
  resolveLeave(choice: "stop" | "background" | null, remember = false) {
    const l = get().leaving;
    set({ leaving: null });
    if (!l || !choice) return;
    if (remember) useSettings.setState({ onLeave: choice });
    leaveWith(choice, l.next);
  },

  /** 点击延伸问题（以及追问、看看新进展）：开始检索、把主线切过来并激活 */
  ask(id: string) {
    const n = get().nodes[id];
    if (n?.kind === "question") recordAngle(n.dir, get().map?.id, true);
    expandTo(id);
    setSpine(id);
    runAnswer(id);
    activate(id);
  },

  retry(id: string) {
    const n = get().nodes[id];
    if (!n) return;
    if (n.links.length && n.op) runSynthesis(id, n.op, n.instruction ?? undefined, n.links, true);
    else runAnswer(id);
  },

  /** 搜索更多来源：换角度补充检索，合并来源后重新整理答案（未回答的延伸问题会重新生成） */
  moreSources(id: string) {
    const n = get().nodes[id];
    if (!isReady(n) || n.links.length) return;
    runAnswer(id, { queries: n.queries, sources: n.sources });
  },

  /** 看看新进展：在节点下新建一个只检索回答之后发布内容的子节点 */
  followNews(id: string) {
    const n = get().nodes[id];
    const since = n && newsSince(n);
    if (!since) return;
    const [, m, d] = since.split("-").map(Number);
    const q = `${n.q.replace(/[？?。]$/, "")}：${m}月${d}日以来的新进展`;
    const child = addNode(newNode({ kind: "answer", dir: "新进展", q, parent: id, since }));
    actions.ask(child);
  },

  followup(parentId: string, q: string) {
    const id = addNode(newNode({ kind: "answer", dir: "追问", q, parent: parentId }));
    actions.ask(id);
  },

  /** 延伸列表底部的输入：交给输入框路由判断意图；返回是否已受理 */
  command(parentId: string, input: string) {
    return runCommand(parentId, input, (question) => actions.followup(parentId, question));
  },

  runOp(op: OpKind, instruction?: string) {
    const { selected, nodes } = get();
    const linked = selected.filter((id) => isReady(nodes[id]));
    if (linked.length < 2) return;
    const label = { summary: "总结", relate: "关联", deepen: "深入了解", expand: "扩散", custom: instruction ?? "" }[op];
    set({ selected: [] });
    const id = addNode(newNode({ kind: "answer", q: label, links: linked, op, instruction: instruction ?? null, status: "loading", ...freeSpot(linked) }));
    runSynthesis(id, op, instruction, linked);
    activate(id);
  },

  /**
   * 点选一个节点：主线跟着切过来，从根到它的整条路径拉成一条水平线（用户选定的方案 A：点开新问题和点回已答节点一个规则，
   * 原来只在提问时切换，点回老节点就不对齐）。setSpine 平移这棵树的根锚点，被点的节点停在原处，其他分支滑过去
   */
  activate(id: string) {
    followSpine(id);
    activate(id);
  },

  toggleCollapse(id: string) {
    const { nodes, activeId } = get();
    const n = nodes[id];
    const collapsing = !n.collapsed;
    const hidesActive = collapsing && activeId && activeId !== id && chain(nodes, activeId).some((a) => a.id === id);
    commitNodes({ ...nodes, [id]: { ...n, collapsed: collapsing } }, hidesActive ? focusOf(id) : {});
  },

  setSelected(ids: string[]) {
    set({ selected: ids });
  },

  toggleSelected(id: string) {
    const s = get().selected;
    set({ selected: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
  },

  /** 拖动：orig 为拖动开始时各节点的偏移 */
  moveNodes(orig: Record<string, { dx: number; dy: number }>, ddx: number, ddy: number) {
    const nodes = { ...get().nodes };
    const ids = new Set(Object.keys(orig));
    for (const id of ids) {
      // 祖先也在拖动集合里时只移动祖先，避免位移叠加
      if (chain(nodes, id).slice(0, -1).some((a) => ids.has(a.id))) continue;
      nodes[id] = { ...nodes[id], dx: orig[id].dx + ddx, dy: orig[id].dy + ddy };
    }
    commitNodes(nodes);
  },

  setSize(id: string, w: number, h: number, head = 0) {
    setSize(id, w, h, head);
  },

  setRevealing(id: string, on: boolean) {
    const r = get().revealing;
    if (!!r[id] === on) return;
    const next = { ...r };
    if (on) next[id] = true;
    else delete next[id];
    set({ revealing: next });
  },

  /** 点开或收起卡片上方的问题行；传 null 收起 */
  toggleHead(id: string | null) {
    set({ headOpen: id && get().headOpen !== id ? id : null });
  },

  /** 详情抽屉打开已完成的节点时调用：没有详解就生成；force 用于失败后重试或重新生成 */
  loadDetail(id: string, force = false) {
    const n = get().nodes[id];
    if (!isReady(n) || isDetailRunning(id)) return;
    if (!force && n.detailStatus !== "idle") return;
    runDetail(id);
  },

  openDrawer(id: string) {
    followSpine(id);
    commitNodes(get().nodes, { drawerId: id, reading: null, ...focusOf(id) });
    revealBranch(id);
    reportAction("detail", { nodeId: id });
  },
  closeDrawer: () => set({ drawerId: null, reading: null }),

  /**
   * 打开来源：按设置用系统浏览器，或在侧边栏的阅读视图里打开（需要知道来源属于哪个节点）。
   * 没有链接的权威卡片只能在阅读视图里看。
   */
  openSource(nodeId: string | null, n: number, url: string) {
    if (nodeId && (useSettings.getState().openSource === "reader" || !url)) actions.readSource(nodeId, n);
    else if (url) openExternal(url);
  },

  /** 在侧边栏阅读某个节点的第 n 条来源（不看设置，气泡里的「在侧边栏阅读」直接用它） */
  readSource(nodeId: string, n: number) {
    const s = get().nodes[nodeId]?.sources[n - 1];
    if (!s) return;
    if (s.url) recordSite(s.url, get().map?.id);
    commitNodes(get().nodes, { drawerId: nodeId, reading: { nodeId, sourceId: s.id }, ...focusOf(nodeId) });
  },

  /** 阅读视图里切换到上一条 / 下一条来源（循环） */
  stepSource(delta: number) {
    const { reading, nodes } = get();
    const sources = reading ? nodes[reading.nodeId]?.sources ?? [] : [];
    const i = reading ? sources.findIndex((s) => s.id === reading.sourceId) : -1;
    if (!reading || i < 0) return;
    set({ reading: { nodeId: reading.nodeId, sourceId: sources[(i + delta + sources.length) % sources.length].id } });
  },

  closeReader: () => set({ reading: null }),

  /** 阅读视图读到全文后写回来源：之后写答案、引用气泡也能用全文 */
  setSourceText(nodeId: string, sourceId: string, text: string) {
    patch(nodeId, (node) => ({ sources: node.sources.map((s) => (s.id === sourceId ? { ...s, text } : s)) }));
  },
  openSummary: () => set({ summaryOpen: true }),
  closeSummary: () => set({ summaryOpen: false }),
  toggleSearch: () => set({ search: !get().search }),
};
