import assert from "node:assert/strict";
import { test } from "node:test";
import { set, setSize } from "./core.ts";
import { useGraph } from "./core.ts";
import type { GNode } from "./types.ts";

const node = (p: Partial<GNode> & Pick<GNode, "id">): GNode => ({
  kind: "answer", dir: null, nextWhy: null, q: p.id, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: "", framed: false, thinking: "", points: [], visual: null, memory: null, sources: [], queries: [], searchResults: 0, searches: [], steps: [], dropped: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null,
  detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null, dx: 0, dy: 0, ax: 0, ay: 0, ...p,
});

function start() {
  set({ nodes: { r: node({ id: "r", ay: 100, children: ["c"] }), c: node({ id: "c", parent: "r" }) }, sizes: {}, spineId: "c", activeId: null });
}

test("主线节点第一次测量时不平移整棵树：它还没在旧位置显示过", () => {
  start();
  setSize("r", 380, 200, 28);
  setSize("c", 380, 160, 28);
  assert.equal(useGraph.getState().nodes.r.ay, 100);
});

test("延伸问题点开变成回答、问题行出现时，整棵树补回问题行的高度，被点的节点留在原处", () => {
  start();
  setSize("r", 380, 200, 28);
  setSize("c", 380, 44);
  const before = useGraph.getState().pos.c.y;
  setSize("c", 380, 160, 28);
  const s = useGraph.getState();
  assert.equal(s.nodes.r.ay, 128);
  assert.equal(s.pos.c.y, before);
});
