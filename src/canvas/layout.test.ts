import assert from "node:assert/strict";
import { test } from "node:test";
import type { GNode } from "../store/types.ts";
import { END, layout, ROW_GAP, slotKey } from "./layout.ts";

const node = (p: Partial<GNode> & Pick<GNode, "id">): GNode => ({
  kind: "answer", dir: null, nextWhy: null, q: p.id, parent: null, links: [], op: null, instruction: null, children: [], collapsed: false, settled: false,
  status: "ready", stage: null, stageDetail: null, images: [], imageNote: "", summary: "", framed: false, thinking: "", points: [], visual: null, memory: null, sources: [], queries: [], searchResults: 0, searches: [], steps: [], dropped: [], searchMs: 0, searchMode: null, compareOf: null, answeredAt: 0, since: null,
  detail: "", detailStatus: "idle", error: null, errorCode: null, errorHint: null, dx: 0, dy: 0, ax: 0, ay: 0, ...p,
});

test("布局顶部固定：父节点变高时自己和子节点的顶边都不动", () => {
  const nodes = {
    r: node({ id: "r", ax: 10, ay: 100, children: ["a", "b"] }),
    a: node({ id: "a", kind: "question", parent: "r" }),
    b: node({ id: "b", kind: "question", parent: "r" }),
  };
  const small = layout(nodes, { r: { w: 340, h: 120 }, a: { w: 260, h: 44 }, b: { w: 260, h: 44 } });
  const tall = layout(nodes, { r: { w: 340, h: 400 }, a: { w: 260, h: 44 }, b: { w: 260, h: 44 } });
  for (const l of [small, tall]) {
    assert.equal(l.pos.r.y, 100);
    assert.equal(l.pos.a.y, 100);
    assert.equal(l.pos.b.y, 100 + 44 + ROW_GAP);
  }
});

test("留了输入框的节点：输入框排在子节点最下方，并计入子树高度；折叠时不留", () => {
  const nodes = {
    r: node({ id: "r", children: ["a"] }),
    a: node({ id: "a", kind: "question", parent: "r" }),
    s: node({ id: "s" , ay: 0 }),
  };
  const sizes = { r: { w: 340, h: 40 }, a: { w: 260, h: 44 }, [slotKey("r")]: { w: 260, h: 40 } };
  const onlyR = (n: { id: string }) => n.id === "r";
  const l = layout(nodes, sizes, onlyR);
  assert.deepEqual(l.slots, { r: { x: 340 + 72, y: 44 + ROW_GAP, w: 260, h: 40 } });
  assert.deepEqual(layout(nodes, sizes, null).slots, {});
  assert.deepEqual(layout({ ...nodes, r: { ...nodes.r, collapsed: true } }, sizes, onlyR).slots, {});
});

test("兄弟紧凑排列：前一个节点右侧的子节点列很长时，后一个兄弟仍紧贴在它下方；展开后只把它的子列往下挪、避开同列的节点", () => {
  const q = { w: 260, h: 44 };
  const base = {
    r: node({ id: "r", children: ["a", "b"] }),
    a: node({ id: "a", parent: "r", children: ["a1", "a2", "a3", "a4"] }),
    b: node({ id: "b", kind: "question", parent: "r" }),
    a1: node({ id: "a1", kind: "question", parent: "a" }),
    a2: node({ id: "a2", kind: "question", parent: "a" }),
    a3: node({ id: "a3", kind: "question", parent: "a" }),
    a4: node({ id: "a4", kind: "question", parent: "a" }),
  };
  const sizes = { r: { w: 340, h: 100 }, a: { w: 340, h: 120 }, b: q, a1: q, a2: q, a3: q, a4: q, b1: q };
  // a 的子列高 4 × 44 + 3 × 16 = 224，但没有子节点的 b 只需避开 a 本身
  assert.equal(layout(base, sizes).pos.b.y, 120 + ROW_GAP);
  // b 有了子节点：b 自己仍贴着 a，只有它的子列避开 a 的子列、排到 a4 下方（原来整棵子树连 b 一起被推到 a4 下方）
  const grown = { ...base, b: { ...base.b, kind: "answer" as const, children: ["b1"] }, b1: node({ id: "b1", kind: "question", parent: "b" }) };
  const l = layout(grown, { ...sizes, b: { w: 340, h: 120 } });
  assert.equal(l.pos.b.y, 120 + ROW_GAP);
  assert.equal(l.pos.b1.y, l.pos.a4.y + 44 + ROW_GAP);
});

test("被挪开的子列不撞上后面的兄弟：b 的子列往下挪后，c 排在 b 的子列下方", () => {
  const q = { w: 260, h: 44 }, a = { w: 340, h: 120 };
  const nodes = {
    r: node({ id: "r", children: ["a", "b", "c"] }),
    a: node({ id: "a", parent: "r", children: ["a1", "a2", "a3", "a4"] }),
    b: node({ id: "b", parent: "r", children: ["b1", "b2"] }),
    c: node({ id: "c", parent: "r", children: ["c1"] }),
    a1: node({ id: "a1", kind: "question", parent: "a" }), a2: node({ id: "a2", kind: "question", parent: "a" }),
    a3: node({ id: "a3", kind: "question", parent: "a" }), a4: node({ id: "a4", kind: "question", parent: "a" }),
    b1: node({ id: "b1", kind: "question", parent: "b" }), b2: node({ id: "b2", kind: "question", parent: "b" }),
    c1: node({ id: "c1", kind: "question", parent: "c" }),
  };
  const sizes = { r: a, a, b: a, c: a, a1: q, a2: q, a3: q, a4: q, b1: q, b2: q, c1: q };
  const { pos } = layout(nodes, sizes);
  const boxes = Object.values(pos);
  for (const p of boxes) for (const o of boxes) if (p !== o) assert.ok(!(p.x < o.x + o.w && o.x < p.x + p.w && p.y < o.y + o.h && o.y < p.y + p.h), "节点不重叠");
  assert.equal(pos.b.y, pos.a.y + 120 + ROW_GAP);
  assert.ok(pos.c1.y >= pos.b2.y + 44 + ROW_GAP);
});

test("主线拉直：沿第三个子节点往下追问，整条路径与根同一高度，前面的兄弟排到上方且不重叠", () => {
  const q = { w: 260, h: 44 }, a = { w: 340, h: 200 };
  const nodes = {
    r: node({ id: "r", ay: 0, children: ["x", "y", "m"] }),
    x: node({ id: "x", parent: "r" }),
    y: node({ id: "y", parent: "r" }),
    m: node({ id: "m", parent: "r", children: ["m1", "m2"] }),
    m1: node({ id: "m1", kind: "question", parent: "m" }),
    m2: node({ id: "m2", parent: "m" }),
  };
  const sizes = { r: a, x: a, y: a, m: a, m1: q, m2: a };
  const before = layout(nodes, sizes).pos;
  assert.ok(before.m2.y > before.m.y && before.m.y > 0, "没有主线时越往深处越往下");
  const { pos } = layout(nodes, sizes, null, "m2");
  assert.equal(pos.m.y, 0);
  assert.equal(pos.m2.y, 0);
  // 主线前的兄弟按原顺序向上排开，各自的底边与下一个兄弟的顶边隔 ROW_GAP
  assert.equal(pos.y.y + a.h + ROW_GAP, pos.m.y);
  assert.equal(pos.x.y + a.h + ROW_GAP, pos.y.y);
  assert.equal(pos.m1.y + q.h + ROW_GAP, pos.m2.y);
});

test("主线拉直：后面的兄弟避开上方兄弟垂下来的子列", () => {
  const q = { w: 260, h: 44 }, a = { w: 340, h: 60 };
  const nodes = {
    r: node({ id: "r", children: ["u", "m", "d"] }),
    u: node({ id: "u", parent: "r", children: ["u1", "u2", "u3", "u4"] }),
    m: node({ id: "m", kind: "question", parent: "r" }),
    d: node({ id: "d", parent: "r", children: ["d1"] }),
    u1: node({ id: "u1", kind: "question", parent: "u" }),
    u2: node({ id: "u2", kind: "question", parent: "u" }),
    u3: node({ id: "u3", kind: "question", parent: "u" }),
    u4: node({ id: "u4", kind: "question", parent: "u" }),
    d1: node({ id: "d1", kind: "question", parent: "d" }),
  };
  const { pos } = layout(nodes, { r: a, u: a, m: q, d: a, u1: q, u2: q, u3: q, u4: q, d1: q }, null, "m");
  assert.equal(pos.m.y, 0);
  assert.equal(pos.u.y + a.h + ROW_GAP, pos.m.y);
  assert.ok(pos.u4.y > 0, "u 的子列垂到主线以下");
  assert.equal(pos.d1.y, pos.u4.y + q.h + ROW_GAP);
});

test("问透的收尾记号排在子列最前面，输入框接在它下面；长出子节点或折叠后不再留位置", () => {
  const nodes = { r: node({ id: "r", settled: true }) };
  const sizes = { r: { w: 380, h: 120 }, [slotKey("r")]: { w: 380, h: 44 } };
  const all = () => true;
  const l = layout(nodes, sizes, all);
  assert.deepEqual(l.ends.r, { x: 380 + 72, y: 0, ...END });
  assert.equal(l.slots.r.y, END.h + ROW_GAP);
  const grown = { r: { ...nodes.r, children: ["a"] }, a: node({ id: "a", kind: "question", parent: "r" }) };
  assert.deepEqual(layout(grown, sizes, all).ends, {});
  assert.deepEqual(layout({ r: { ...nodes.r, collapsed: true } }, sizes).ends, {});
});

test("收尾记号跟着子列一起避让：问透的兄弟贴着上一个兄弟放，记号排到上一个兄弟的子列下面", () => {
  const q = { w: 380, h: 44 };
  const kidsOfA = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const nodes: Record<string, GNode> = {
    r: node({ id: "r", children: ["a", "b"] }),
    a: node({ id: "a", parent: "r", children: kidsOfA }),
    b: node({ id: "b", parent: "r", settled: true }),
    ...Object.fromEntries(kidsOfA.map((id) => [id, node({ id, kind: "question", parent: "a" })])),
  };
  const sizes = { r: { w: 380, h: 120 }, a: { w: 380, h: 200 }, b: { w: 380, h: 120 }, ...Object.fromEntries(kidsOfA.map((id) => [id, q])) };
  const { pos, ends } = layout(nodes, sizes);
  assert.equal(pos.b.y, 200 + ROW_GAP);
  assert.equal(ends.b.y, pos.a6.y + q.h + ROW_GAP);
});

test("卡片上方问题行高度不同时，主线按卡片顶边对齐，下一个兄弟连同问题行排在上一张卡片下方", () => {
  const nodes = {
    r: node({ id: "r", ay: 100, children: ["a", "b"] }),
    a: node({ id: "a", parent: "r", children: ["q"] }),
    b: node({ id: "b", parent: "r" }),
    q: node({ id: "q", kind: "question", parent: "a" }),
  };
  const sizes = { r: { w: 380, h: 200, head: 48 }, a: { w: 380, h: 150, head: 28 }, b: { w: 380, h: 120, head: 28 }, q: { w: 380, h: 44 } };
  const { pos } = layout(nodes, sizes, null, "a");
  assert.equal(pos.r.y, 100, "根的锚点仍是节点左上角");
  const cardTop = (id: keyof typeof pos) => pos[id].y + (pos[id].head ?? 0);
  assert.equal(cardTop("a"), cardTop("r"));
  assert.equal(pos.q.y, cardTop("a"), "延伸问题与父卡片顶边对齐");
  assert.equal(pos.b.y, pos.a.y + 150 + ROW_GAP, "问题行算在节点占地里，不压住上一张卡片");
});
