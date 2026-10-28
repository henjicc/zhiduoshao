import assert from "node:assert/strict";
import { test } from "node:test";
import type { GNode } from "../store/types.ts";
import { ago, groupOf, INTERRUPTED, matches, maxSeq, metaOf, restoreNodes, toRecord, worthSaving } from "./snapshot.ts";

const node = (p: Partial<GNode> & Pick<GNode, "id" | "q">): GNode => ({
  kind: "answer", dir: null, nextWhy: null, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: "", framed: false, thinking: "", points: [], visual: null, memory: null, sources: [], queries: [], searchResults: 0, searches: [], steps: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null, detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null,
  dx: 0, dy: 0, ax: 0, ay: 0, ...p,
});

test("存档：去掉思考过程，标题取起始问题，只统计已完成的回答", () => {
  const nodes = {
    n1: node({ id: "n1", q: "起始问题", thinking: "想了很多", children: ["n2", "n3"] }),
    n2: node({ id: "n2", q: "追问一", parent: "n1", kind: "question", status: "idle" }),
    n3: node({ id: "n3", q: "追问二", parent: "n1", status: "loading", stage: "search" }),
  };
  const r = toRecord("m1", 1, 2, nodes, { x: 10, y: 20, s: 0.8 });
  assert.equal(r.nodes.n1.thinking, "");
  assert.equal(r.nodes.n3.stage, null);
  const m = metaOf(r);
  assert.equal(m.title, "起始问题");
  assert.equal(m.answers, 1);
  assert.ok(matches(m, "追问二"));
  assert.ok(!matches(m, "无关"));
});

test("存档：没有任何完成的回答时不保存", () => {
  assert.equal(worthSaving({ n1: node({ id: "n1", q: "x", status: "error" }) }), false);
  assert.equal(worthSaving({ n1: node({ id: "n1", q: "x" }) }), true);
});

test("恢复：进行中的节点标记为中断，编号从最大值继续", () => {
  const out = restoreNodes({
    n1: node({ id: "n1", q: "a" }),
    n7: node({ id: "n7", q: "b", status: "streaming" }),
  });
  assert.equal(out.n1.status, "ready");
  assert.equal(out.n7.status, "error");
  assert.equal(out.n7.error, INTERRUPTED);
  assert.equal(maxSeq(out), 7);
});

test("历史时间：按本地日期分组", () => {
  const now = new Date(2026, 9, 19, 15, 0).getTime();
  assert.equal(groupOf(new Date(2026, 9, 19, 0, 5).getTime(), now), "今天");
  assert.equal(groupOf(new Date(2026, 9, 18, 23, 0).getTime(), now), "昨天");
  assert.equal(groupOf(new Date(2026, 9, 13, 9, 0).getTime(), now), "近 7 天");
  assert.equal(groupOf(new Date(2026, 9, 12, 9, 0).getTime(), now), "更早");
  assert.equal(ago(now - 30_000, now), "刚刚");
  assert.equal(ago(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(ago(new Date(2026, 9, 1).getTime(), now), "10 月 1 日");
  assert.equal(ago(new Date(2025, 9, 1).getTime(), now), "2025 年 10 月 1 日");
});

test("存档记下激活过的节点，已删除的节点不写入", () => {
  const nodes = { n1: node({ id: "n1", q: "根" }), n2: node({ id: "n2", q: "子" }) };
  const r = toRecord("m", 1, 2, nodes, { x: 0, y: 0, s: 1 }, { n1: true, n2: true, gone: true });
  assert.deepEqual(r.opened, ["n1", "n2"]);
  assert.deepEqual(toRecord("m", 1, 2, nodes, { x: 0, y: 0, s: 1 }).opened, []);
});
