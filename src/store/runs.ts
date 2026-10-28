import { api } from "../api/client.ts";
import { useSettings } from "../settings/store.ts";
import { buildMemory, usedSites } from "../memory/brief.ts";
import { noteAsk } from "../memory/run.ts";
import { recordAngle } from "../memory/store.ts";
import { articleKeys, keepFullText, type AnswerRequest, type OpKind, type StreamEvent } from "../core/protocol.ts";
import type { GNode } from "./types.ts";
import { addAt, addNode, commitNodes, get, isReady, newNode, parkedDone, patch, patchAt, pathOf, relatedQuestions, set, stripCites, toContext } from "./core.ts";
import { toast } from "./toast.ts";
import { revealBranch } from "./view.ts";
import { reportAction } from "@henjicc/web-replay-probe";

// 请求编排：发起回答、综合、详解与输入框路由，把流式事件写回节点，并管理取消。
// 每个节点同一时间各类请求最多一个：回答 / 综合用节点 id，详解与输入框各有自己的键，互不打断。
// 不同节点的请求并行进行。请求属于发起它的地图：离开地图时可以全部取消，也可以留在后台继续，结果写回那张地图。

/** 进行中的请求，键为「地图 id|请求键」 */
const controllers = new Map<string, AbortController>();
const detailKey = (id: string) => `${id}:detail`;
const commandKey = (id: string) => `${id}:command`;
const mapOf = () => get().map?.id ?? "";
/** 发请求时的回答偏好（输入框旁选的） */
const prefs = () => useSettings.getState().prefs;
const full = (key: string, map = mapOf()) => `${map}|${key}`;
const keysOf = (map: string) => [...controllers.keys()].filter((k) => k.startsWith(`${map}|`));

function claim(key: string) {
  const k = full(key);
  controllers.get(k)?.abort();
  const ctrl = new AbortController();
  controllers.set(k, ctrl);
  return ctrl;
}

function release(key: string) {
  const k = full(key);
  controllers.get(k)?.abort();
  controllers.delete(k);
}

/** 请求结束：后台地图的最后一个请求结束时通知存档 */
function finished(map: string, key: string) {
  controllers.delete(full(key, map));
  if (!keysOf(map).length) parkedDone(map);
}

/** 当前地图还有几个节点在回答、综合或生成详解（输入框的意图判断很快，不算） */
export function runningCount(map = mapOf()) {
  return new Set(keysOf(map).filter((k) => !k.endsWith(":command")).map((k) => k.slice(map.length + 1).split(":")[0])).size;
}

/** 取消一张地图的请求；only 为 "command" 时只取消输入框（留在后台的地图不需要它） */
export function cancelMap(map = mapOf(), only?: "command") {
  for (const k of keysOf(map)) {
    if (only && !k.endsWith(":command")) continue;
    controllers.get(k)!.abort();
    controllers.delete(k);
  }
}

export const isDetailRunning = (id: string) => controllers.has(full(detailKey(id)));

/** 把回答 / 综合的流式事件写回发起请求的那张地图（可能已在后台） */
function applyEvent(map: string, id: string, ev: StreamEvent) {
  const patch = (fn: Parameters<typeof patchAt>[2]) => patchAt(map, id, fn);
  switch (ev.type) {
    case "stage":
      // 给痕迹录制标时间轴：每轮检索开始、读完来源开始写答案
      if (ev.stage === "search") reportAction("search", { nodeId: id });
      else if (ev.stage === "compose") reportAction("sources-read", { nodeId: id });
      return patch((n) => ({
        // 换阶段时思考流接着往下滚、另起一行，不清空：清空会让卡片在思考流和骨架屏之间来回切换，看起来一闪一闪
        stage: ev.stage, stageDetail: ev.detail ?? null, thinking: n.stage === ev.stage || !n.thinking || n.thinking.endsWith("\n") ? n.thinking : n.thinking + "\n",
        ...(ev.stage === "search" && ev.detail?.queries ? { queries: [...n.queries, ...ev.detail.queries] } : {}),
      }));
    case "thinking":
      return patch((n) => ({ thinking: n.thinking + ev.delta }));
    case "vision":
      return patch(() => ({ imageNote: ev.text }));
    case "sources": {
      patch((n) => ({ sources: keepFullText(n.sources, ev.sources) }));
      // 正在读的来源被复查剔除了：退出阅读视图，否则之后补搜又搜回这条时侧边栏会自己跳回阅读
      const { reading } = get();
      if (get().map?.id === map && reading?.nodeId === id && !ev.sources.some((s) => s.id === reading.sourceId)) set({ reading: null });
      return;
    }
    case "searched":
      return patch((n) => ({
        searchResults: n.searchResults + ev.results, searches: [...n.searches, ...ev.plans], searchMs: n.searchMs + ev.ms,
        steps: [...n.steps, { kind: "search", round: ev.plans[0]?.round ?? 1, results: ev.results, unique: ev.unique, ms: ev.ms, queries: ev.plans, ...(ev.reason ? { reason: ev.reason } : {}) }],
      }));
    case "read":
      return patch((n) => ({ steps: [...n.steps, { kind: "read", titles: ev.titles, ok: ev.ok }] }));
    case "title":
      return patch(() => ({ q: ev.text }));
    case "summary":
      return patch((n) => ({ status: "streaming", summary: n.summary + ev.delta }));
    case "point":
      return patch((n) => ({ status: "streaming", points: [...n.points, ev.point] }));
    case "visual":
      return patch(() => ({ status: "streaming", visual: ev.visual }));
    case "followup":
      recordAngle(ev.followup.dir, map, false);
      return addAt(map, { kind: "question", dir: ev.followup.dir, q: ev.followup.q, nextWhy: ev.followup.why ?? null, parent: id });
    case "done":
      patch((n) => ({ status: "ready", stage: null, answeredAt: Date.now(), memory: n.memory && trimNote({ ...n.memory, sites: usedSites(n.memory, n.queries) }) }));
      if (mapOf() === map && get().activeId === id) revealBranch(id, true);
      reportAction("answered", { nodeId: id });
      return finished(map, id);
    case "error":
      patch(() => ({ status: "error", error: ev.message, errorCode: ev.code ?? null, errorHint: ev.hint ?? null }));
      return finished(map, id);
    case "text":
    case "ask":
      return;
  }
}

/** 卡片上的记忆标注：什么都没用上时不显示 */
const trimNote = (m: NonNullable<GNode["memory"]>) => (m.sites.length || m.recalls.length ? m : null);

/** 重新回答前清空节点：上次留下的延伸问题与详解作废；搜索更多来源时保留已用过的查询词 */
function resetAnswer(id: string, keepQueries: boolean) {
  const nodes = { ...get().nodes };
  const n = nodes[id];
  for (const c of n.children) if (nodes[c].kind === "question") delete nodes[c];
  nodes[id] = {
    ...n, kind: "answer", status: "loading", stage: null, stageDetail: null, summary: "", thinking: "", points: [], visual: null, memory: null, sources: [], error: null, errorCode: null, errorHint: null,
    detail: "", detailStatus: "idle",
    queries: keepQueries ? n.queries : [],
    searchResults: keepQueries ? n.searchResults : 0,
    searches: keepQueries ? n.searches : [],
    steps: keepQueries ? n.steps : [],
    searchMs: keepQueries ? n.searchMs : 0,
    children: n.children.filter((c) => nodes[c]),
  };
  commitNodes(nodes);
}

/** 回答一个问题节点；more：搜索更多来源时带上已有查询词与来源，补充检索后重新整理答案 */
export function runAnswer(id: string, more?: AnswerRequest["more"]) {
  release(detailKey(id));
  const ctrl = claim(id);
  const map = mapOf();
  resetAnswer(id, !!more);
  const n = get().nodes[id];
  // 对比节点固定联网方式，其余跟随顶栏的联网开关
  const search = n.searchMode ? n.searchMode === "on" : get().search;
  // 第一次回答才算一次提问（重试、补充检索、看看新进展不算），记进个人记忆
  if (!more && !n.since && !n.answeredAt && !n.compareOf) noteAsk(n.q, map);
  reportAction("ask", { nodeId: id, question: n.q });
  // 看看新进展：上一层已有的来源不算新内容
  const exclude = n.since && n.parent ? get().nodes[n.parent]?.sources.flatMap(articleKeys) : undefined;
  const req: AnswerRequest = { question: n.q, path: pathOf(id), existing: relatedQuestions([id]).filter((q) => q !== n.q), search, images: n.images, imageNote: n.imageNote || undefined, more, since: n.since ?? undefined, exclude, prefs: prefs() };
  // 先从记忆和历史地图里取这次用得上的（读本机数据库，很快），再发请求
  void buildMemory(n.q, map).catch(() => null).then((mem) => {
    if (ctrl.signal.aborted) return;
    if (mem) patchAt(map, id, () => ({ memory: mem.note }));
    void api.answer({ ...req, memory: mem?.brief }, (ev) => applyEvent(map, id, ev), ctrl.signal);
  });
}

/** 综合节点：由选中的几个节点生成；重试时先清空上次的结果 */
export function runSynthesis(id: string, op: OpKind, instruction: string | undefined, linked: string[], retry = false) {
  if (retry) {
    release(detailKey(id));
    patch(id, () => ({ status: "loading", error: null, errorCode: null, errorHint: null, thinking: "", summary: "", points: [], visual: null, memory: null, sources: [], searchResults: 0, searches: [], steps: [], searchMs: 0, stage: null, detail: "", detailStatus: "idle" }));
  }
  const ctrl = claim(id);
  const map = mapOf();
  const { nodes, search } = get();
  void api.synthesize(
    { op, instruction, nodes: linked.map((l) => toContext(nodes[l])), existing: relatedQuestions(linked), search, prefs: prefs() },
    (ev) => applyEvent(map, id, ev),
    ctrl.signal,
  );
}

/** 详解：在详情抽屉里按需生成，复用节点已有的来源 */
export function runDetail(id: string) {
  const key = detailKey(id);
  const ctrl = claim(key);
  const map = mapOf();
  const n = get().nodes[id];
  patch(id, () => ({ detail: "", detailStatus: "loading", thinking: "" }));
  void api.detail({ question: n.q, path: pathOf(id), node: toContext(n), prefs: prefs() }, (ev) => {
    // 回答被重新生成时（重试、搜索更多来源）这次详解作废
    if (controllers.get(full(key, map)) !== ctrl) return;
    if (ev.type === "thinking") patchAt(map, id, (x) => ({ thinking: x.thinking + ev.delta }));
    else if (ev.type === "text") patchAt(map, id, (x) => ({ detailStatus: "streaming", detail: x.detail + ev.delta }));
    else if (ev.type === "done") { patchAt(map, id, () => ({ detailStatus: "ready", thinking: "" })); finished(map, key); }
    else if (ev.type === "error") { patchAt(map, id, () => ({ detailStatus: "error", thinking: "" })); finished(map, key); }
  }, ctrl.signal);
}

/**
 * 延伸列表底部的输入：交给 router.ts 判断意图。ask 时由 onAsk 新建追问节点并回答；
 * branch 时把新的探索方向加到这个节点下。返回是否已受理（同一时间只处理一条）。
 */
export function runCommand(parentId: string, input: string, onAsk: (question: string) => void) {
  const { nodes, slotBusy } = get();
  const p = nodes[parentId];
  if (slotBusy || !isReady(p) || !input.trim()) return false;
  const key = commandKey(parentId);
  const ctrl = claim(key);
  set({ slotBusy: true });
  const finish = () => { controllers.delete(full(key)); set({ slotBusy: false }); };
  const existing = p.children.map((c) => nodes[c]?.q).filter(Boolean);
  void api.command({ input: input.trim(), node: { q: p.q, summary: stripCites(p.summary) }, path: pathOf(parentId), existing }, (ev) => {
    if (ctrl.signal.aborted) return;
    if (ev.type === "ask") { finish(); onAsk(ev.question); }
    else if (ev.type === "followup") {
      if (get().nodes[parentId]?.collapsed) patch(parentId, () => ({ collapsed: false }));
      addNode(newNode({ kind: "question", dir: ev.followup.dir, q: ev.followup.q, parent: parentId }));
    } else if (ev.type === "done") finish();
    else if (ev.type === "error") { finish(); toast(ev.message); }
  }, ctrl.signal);
  return true;
}
