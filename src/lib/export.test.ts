import assert from "node:assert/strict";
import { test } from "node:test";
import type { GNode } from "../store/types.ts";
import { fileName, nodeMd, nodesMd, treeOrder } from "./export.ts";

const node = (id: string, p: Partial<GNode> = {}): GNode => ({
  id, kind: "answer", dir: null, nextWhy: null, q: `问题${id}`, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: `结论${id}。[1]`, framed: false, thinking: "", points: [], visual: null, memory: null,
  sources: [{ id: "s", title: "标题 | 竖线", url: "https://e.com/a", site: "站点", snippet: "" }], queries: [], searchResults: 0, searches: [], steps: [], dropped: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null,
  detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null, dx: 0, dy: 0, ax: 0, ay: 0, ...p,
});

test("单个节点：结论、卡片转表格、要点、详解去掉配图标记、来源带链接", () => {
  const md = nodeMd(node("1", {
    points: [{ text: "要点", cites: [1] }],
    visual: { kind: "bar", title: "跑分", unit: "分", items: [{ label: "A|B", value: 86, cites: [1] }, { label: "C", value: 72, cites: [1] }] },
    detail: "## 原因\n\n正文。[1]\n\n[图1]", detailStatus: "ready",
  }));
  assert.match(md, /^# 问题1\n\n结论1。\[1\]/);
  assert.ok(md.includes("| A\\|B | 86分 | [1] |"));
  assert.match(md, /- 要点\[1\]/);
  assert.match(md, /## 详解\n\n#### 原因/);
  assert.doesNotMatch(md, /\[图1\]/);
  assert.ok(md.includes("1. [标题 | 竖线](https://e.com/a)（站点）"));
});

test("整张地图：按树的顺序导出回答完成的节点，未回答的问题跳过", () => {
  const nodes = {
    a: node("a", { children: ["b", "q"] }),
    b: node("b", { parent: "a" }),
    q: node("q", { parent: "a", kind: "question", status: "idle" }),
    s: node("s", { links: ["a", "b"] }),
  };
  const md = nodesMd(treeOrder(nodes), "地图");
  assert.deepEqual([...md.matchAll(/^## (问题.+)$/gm)].map((m) => m[1]), ["问题a", "问题b", "问题s"]);
  assert.equal(fileName('a/b:c？"'), "abc.md");
});
