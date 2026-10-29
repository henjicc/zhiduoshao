import assert from "node:assert/strict";
import { test } from "node:test";
import { closeAnswer, reopenAnswer } from "./core.ts";
import type { GNode } from "./types.ts";

const node = (p: Partial<GNode> & Pick<GNode, "id">): GNode => ({
  kind: "answer", dir: null, nextWhy: null, q: p.id, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: "答", framed: false, thinking: "", points: [], visual: null, memory: null, sources: [], queries: [], searchResults: 0, searches: [], steps: [], dropped: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 1, since: null,
  detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null, dx: 0, dy: 0, ax: 0, ay: 0, ...p,
});

const map = () => ({
  r: node({ id: "r", children: ["a", "b"] }),
  a: node({ id: "a", parent: "r", dir: "时机", nextWhy: "先看时机", q: "现在买还是等？", dx: 5, children: ["a1", "a2"] }),
  a1: node({ id: "a1", parent: "a", children: ["a11", "a12"] }),
  a11: node({ id: "a11", parent: "a1", status: "streaming" }),
  a12: node({ id: "a12", parent: "a1", detail: "写了一半", detailStatus: "streaming" }),
  a2: node({ id: "a2", kind: "question", parent: "a" }),
  b: node({ id: "b", kind: "question", parent: "r" }),
});

test("关闭回答：变回原来那条延伸问题，回答和整棵子树去掉，其他节点不动", () => {
  const before = map();
  const { nodes } = closeAnswer(before, "a");
  assert.deepEqual(Object.keys(nodes).sort(), ["a", "b", "r"]);
  const a = nodes.a;
  assert.deepEqual([a.kind, a.q, a.dir, a.nextWhy, a.parent, a.dx, a.status, a.summary, a.children, a.answeredAt], ["question", "现在买还是等？", "时机", "先看时机", "r", 5, "idle", "", [], 0]);
  assert.equal(nodes.r, before.r);
  assert.equal(nodes.b, before.b);
});

test("撤销关闭：子树原样放回，关闭时还在回答的按中断处理、没写完的详解按没生成处理；问题已被重新点开时不撤销", () => {
  const before = map();
  const { nodes, closed } = closeAnswer(before, "a");
  const back = reopenAnswer(nodes, "a", closed)!;
  for (const k of ["r", "a", "a1", "a2", "b"]) assert.equal(back[k], before[k as keyof typeof before]);
  assert.equal(back.a11.status, "error");
  assert.deepEqual([back.a12.detailStatus, back.a12.detail], ["idle", ""]);
  assert.equal(reopenAnswer({ ...nodes, a: { ...nodes.a, kind: "answer" } }, "a", closed), null);
});
