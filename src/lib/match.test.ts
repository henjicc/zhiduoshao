import assert from "node:assert/strict";
import { test } from "node:test";
import { findPassage, quotesFor, sentenceBefore, splitSentences } from "./match.ts";

const SOURCE = "每天到底睡多久最好？关于最佳睡眠时长，网络上有各种观点。一项覆盖32万亚洲人的研究显示，每晚睡7小时的人全因死亡风险最低。睡得过长同样有害，超过9小时的人心血管风险上升。\n周末补觉也要适度。";

test("切句：保留句末标点，换行也分句", () => {
  assert.deepEqual(splitSentences("甲。乙！\n丙？丁；戊"), ["甲。", "乙！", "丙？", "丁；", "戊"]);
});

test("改写过的回答也能对回原文句子", () => {
  const p = findPassage(SOURCE, "亚洲32万人研究显示，每晚7小时全因死亡风险最低。[2][8]");
  assert.deepEqual(p.hits, [2]);
  assert.match(p.sentences[2], /32万亚洲人/);
});

test("相邻句子也很相关时一起高亮", () => {
  const p = findPassage(SOURCE, "每晚睡7小时死亡风险最低，睡超过9小时心血管风险上升");
  assert.deepEqual(p.hits, [2, 3]);
});

test("原文里没有对应内容时不高亮", () => {
  assert.deepEqual(findPassage(SOURCE, "量子计算机的纠错码进展").hits, []);
  assert.deepEqual(findPassage("", "任何内容").hits, []);
});

test("取角标所在的那句话", () => {
  const text = "第一句话。[1]第二句讲成本下降。[2][3]第三句。";
  assert.equal(sentenceBefore(text, text.indexOf("[2]")), "第二句讲成本下降");
  assert.equal(sentenceBefore(text, text.indexOf("[3]")), "第二句讲成本下降");
  assert.equal(sentenceBefore(text, text.indexOf("[1]")), "第一句话");
  const noPunct = "成本降到约557.6万美元[7]，性能对标GPT-4o。";
  assert.equal(sentenceBefore(noPunct, noPunct.indexOf("[7]")), "成本降到约557.6万美元");
});

test("收集节点里引用某条来源的句子：结论、要点、详解，去重", () => {
  const node = {
    summary: "成本很低。[1][2]性能对标前沿。[2]",
    points: [{ text: "完全开源。", cites: [2] }, { text: "无关。", cites: [3] }],
    detail: "## 机制\n- **架构侧**：MoE 降低算力。[2]\n成本很低。[2]",
  };
  assert.deepEqual(quotesFor(node, 2), ["成本很低", "性能对标前沿", "完全开源。", "架构侧：MoE 降低算力"]);
  assert.deepEqual(quotesFor(node, 9), []);
});
