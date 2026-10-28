import assert from "node:assert/strict";
import { test } from "node:test";
import { AnswerParser, parseLearned, parseVisual } from "./format.ts";

const OUTPUT = `结论：AI 服务器需求挤占产能，内存价格回升。[1][9]
要点：
- 原厂转向 HBM，通用产能被压缩。[2][3]
- 渠道库存降至低位 [1]。
追问：
[为什么] 为什么 HBM 更占产能？
[瞎写] 涨价会持续多久？
`;

function run(chunks: string[], sources = 3) {
  const p = new AnswerParser(sources);
  const evs = chunks.flatMap((c) => p.push(c));
  return [...evs, ...p.flush()];
}

const summaryOf = (evs: ReturnType<typeof run>) => evs.flatMap((e) => (e.type === "summary" ? [e.delta] : [])).join("");

test("按任意切分的流式片段解析出相同结果", () => {
  const whole = run([OUTPUT]);
  const byChar = run([...OUTPUT]);
  const by7 = run(OUTPUT.match(/[\s\S]{1,7}/g)!);
  for (const evs of [whole, byChar, by7]) {
    assert.equal(summaryOf(evs), "AI 服务器需求挤占产能，内存价格回升。[1]");
    assert.deepEqual(
      evs.filter((e) => e.type === "point").map((e) => e.type === "point" && e.point),
      [
        { text: "原厂转向 HBM，通用产能被压缩。", cites: [2, 3] },
        { text: "渠道库存降至低位。", cites: [1] },
      ],
    );
    assert.deepEqual(
      evs.filter((e) => e.type === "followup").map((e) => e.type === "followup" && e.followup),
      [
        { dir: "为什么", q: "为什么 HBM 更占产能？" },
        { dir: "瞎写", q: "涨价会持续多久？" },
      ],
    );
  }
});

test("逐字流式时不把未写完的角标或下一个标签当作结论发出", () => {
  const p = new AnswerParser(3);
  const seen: string[] = [];
  for (const ch of "结论：价格上涨。[2]\n要点：\n- a [1]\n") {
    for (const e of p.push(ch)) if (e.type === "summary") seen.push(e.delta);
  }
  assert.ok(!seen.some((d) => /\[\d*$/.test(d) || d.includes("要")), seen.join("|"));
  assert.equal(seen.join(""), "价格上涨。[2]");
});

test("综合节点的标题行与漏写结论标签", () => {
  const evs = run(["标题：两者的关系\n直接写的结论。\n要点：\n- x\n"]);
  assert.deepEqual(evs[0], { type: "title", text: "两者的关系" });
  assert.equal(summaryOf(evs), "直接写的结论。");
});

test("追问：无 表示不需要扩散，不产出延伸问题", () => {
  const p = new AnswerParser(2);
  const evs = [...p.push("结论：答完了。[1]\n要点：\n- 一条。\n- 两条。\n追问：无\n"), ...p.flush()];
  assert.equal(evs.filter((e) => e.type === "followup").length, 0);
  assert.equal(evs.filter((e) => e.type === "point").length, 2);
});

test("解析智能卡片：多行 JSON、越界与无角标条目被丢掉", () => {
  const out = `结论：A 和 B 各有侧重。[1]
数据：{"kind":"table","title":"对比","columns":["型号","端口"],
"rows":[{"cells":["A","8 口"],"cites":[1]},{"cells":["B","5 口"],"cites":[2,9]},{"cells":["C","4 口"],"cites":[]}]}
多余的一行
要点：
- A 端口更多。[1]
`;
  for (const chunks of [[out], [...out]]) {
    const evs = run(chunks);
    assert.deepEqual(
      evs.filter((e) => e.type === "visual").map((e) => e.type === "visual" && e.visual),
      [{ kind: "table", title: "对比", columns: ["型号", "端口"], rows: [{ cells: ["A", "8 口"], cites: [1] }, { cells: ["B", "5 口"], cites: [2] }] }],
    );
    assert.equal(summaryOf(evs), "A 和 B 各有侧重。[1]");
    assert.equal(evs.filter((e) => e.type === "point").length, 1);
  }
});

test("没有来源或格式不对的卡片不显示", () => {
  assert.equal(parseVisual('{"kind":"stats","items":[{"label":"评分","value":"9.2","cites":[1]}]}', 0), null);
  assert.equal(parseVisual('{"kind":"chart"}', 3), null);
  assert.equal(parseVisual("{not json", 3), null);
  assert.deepEqual(parseVisual('{"kind":"stats","items":[{"label":"评分","value":9.2,"cites":[1]}]}', 3), { kind: "stats", title: "", items: [{ label: "评分", value: "9.2", cites: [1] }] });
});

test("图表卡片：数值要是数字，柱状至少两项、折线至少三个点、环形值大于 0", () => {
  assert.deepEqual(
    parseVisual('{"kind":"bar","title":"跑分","unit":"分","items":[{"label":"A","value":"1,200","cites":[1]},{"label":"B","value":"约 900","cites":[1]},{"label":"C","value":800,"cites":[2],"highlight":true}]}', 3),
    { kind: "bar", title: "跑分", unit: "分", items: [{ label: "A", value: 1200, cites: [1] }, { label: "C", value: 800, cites: [2], highlight: true }] },
  );
  assert.equal(parseVisual('{"kind":"line","points":[{"x":"1月","y":1,"cites":[1]},{"x":"2月","y":2,"cites":[1]}]}', 3), null);
  assert.equal(parseVisual('{"kind":"donut","items":[{"label":"A","value":0,"cites":[1]},{"label":"B","value":5,"cites":[1]}]}', 3), null);
});

test("漏写「数据：」时，结论下一行的卡片 JSON 也按卡片解析，不拼进结论", () => {
  const out = `结论：CPU 快约 20%。[1]
{"kind":"stats","title":"提升","items":[{"label":"CPU","value":"约20%","cites":[1]}]}
要点：
- 主摄换成可变光圈。[2]
`;
  for (const chunks of [[out], [...out]]) {
    const evs = run(chunks);
    assert.equal(summaryOf(evs), "CPU 快约 20%。[1]");
    assert.deepEqual(evs.filter((e) => e.type === "visual").map((e) => e.type === "visual" && e.visual.kind), ["stats"]);
    assert.equal(evs.filter((e) => e.type === "point").length, 1);
  }
});

const followupsOf = (evs: ReturnType<typeof run>) => evs.flatMap((e) => (e.type === "followup" ? [e.followup] : []));

test("推荐先问：只认第一条追问的「｜先问：」，后面的去掉标记、不带理由；第一条没标就都不标", () => {
  const out = "结论：好。\n追问：\n[原因] 为什么会这样？｜先问：根子在这\n[走势] 还会持续吗？|先问:也想先问\n[对比] 和去年比呢？\n";
  for (const chunks of [[out], [...out]]) {
    assert.deepEqual(followupsOf(run(chunks)), [
      { dir: "原因", q: "为什么会这样？", why: "根子在这" },
      { dir: "走势", q: "还会持续吗？" },
      { dir: "对比", q: "和去年比呢？" },
    ]);
  }
  assert.deepEqual(followupsOf(run(["结论：好。\n追问：\n[原因] 为什么？\n[走势] 会涨吗？｜先问：关键\n"])), [
    { dir: "原因", q: "为什么？" },
    { dir: "走势", q: "会涨吗？" },
  ]);
});

test("拆题：按结论流式输出，并且只发一次 framed", () => {
  const out = "拆题：你其实在决定两件事。[1]\n要点：\n- 今年涨了约一成。[2]\n追问：\n[时机] 现在买还是等？｜先问：先看值不值得等\n";
  for (const chunks of [[out], [...out]]) {
    const evs = run(chunks);
    assert.equal(summaryOf(evs), "你其实在决定两件事。[1]");
    assert.equal(evs.filter((e) => e.type === "framed").length, 1);
    assert.equal(evs.filter((e) => e.type === "point").length, 1);
  }
  assert.equal(run([OUTPUT]).filter((e) => e.type === "framed").length, 0);
});

test("追问：无 发一次 settled；有追问时不发", () => {
  for (const out of ["结论：答完了。\n追问：无\n", "结论：答完了。\n追问：\n无\n"]) {
    for (const chunks of [[out], [...out]]) assert.equal(run(chunks).filter((e) => e.type === "settled").length, 1);
  }
  assert.equal(run([OUTPUT]).filter((e) => e.type === "settled").length, 0);
});

test("路径回看「已经弄清的」：文字里的角标收进 cites，越界的丢掉，最多 2 个；没有文字的条目丢掉，一条不剩为 null", () => {
  assert.deepEqual(parseLearned('{"learned":[{"text":"涨价来自存储芯片[2]","cites":[1,9]},{"text":"","cites":[1]},{"text":"能等就等到明年下半年","cites":[3,1,2]},{"text":"没来源也留着"}]}', 3), [
    { text: "涨价来自存储芯片", cites: [1, 2] },
    { text: "能等就等到明年下半年", cites: [3, 1] },
    { text: "没来源也留着", cites: [] },
  ]);
  assert.equal(parseLearned('{"learned":[]}', 3), null);
  assert.equal(parseLearned("{坏的", 3), null);
});
