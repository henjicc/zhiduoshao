import assert from "node:assert/strict";
import { test } from "node:test";
import { newsSince } from "./core.ts";
import type { GNode } from "./types.ts";

const node = (p: Partial<GNode>): GNode => ({
  id: "n1", kind: "answer", dir: null, q: "问", parent: null, links: [], op: null, instruction: null, children: [], collapsed: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: "", thinking: "", points: [], visual: null, memory: null, queries: [],
  searchResults: 0, searches: [], steps: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null, detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null, dx: 0, dy: 0, ax: 0, ay: 0,
  sources: [{ id: "u", title: "t", url: "u", site: "s", snippet: "", date: "2026-10-10" }, { id: "v", title: "t", url: "v", site: "s", snippet: "", date: "2026-10-12 08:00:00" }],
  ...p,
});

test("看看新进展从回答那天查起；刚回答完、综合节点、没有来源的不提供；早期存档用最新来源日期", () => {
  const answered = new Date(2026, 9, 16, 10).getTime();
  assert.equal(newsSince(node({ answeredAt: answered }), answered + 2 * 3_600_000), "2026-10-16");
  assert.equal(newsSince(node({ answeredAt: answered }), answered + 60_000), null);
  assert.equal(newsSince(node({ answeredAt: answered, links: ["a", "b"] }), answered + 86_400_000), null);
  assert.equal(newsSince(node({ answeredAt: answered, sources: [] }), answered + 86_400_000), null);
  assert.equal(newsSince(node({})), "2026-10-12");
  assert.equal(newsSince(node({ status: "loading" })), null);
});
