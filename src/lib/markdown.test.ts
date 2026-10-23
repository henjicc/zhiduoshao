import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdown } from "./markdown.ts";

test("单个换行分隔的标题、正文、列表各自成块", () => {
  const md = "## 算法与工程机制\n不靠堆算力，而是系统革新。[8]\n这些改动压低了成本。[7]\n- 架构侧：MoE。[8]\n- 训练侧：强化学习。[10]\n\n## 开源生态\n全部开放。[2]";
  assert.deepEqual(parseMarkdown(md), [
    { type: "h", level: 2, text: "算法与工程机制" },
    { type: "p", text: "不靠堆算力，而是系统革新。[8]这些改动压低了成本。[7]" },
    { type: "ul", items: ["架构侧：MoE。[8]", "训练侧：强化学习。[10]"] },
    { type: "h", level: 2, text: "开源生态" },
    { type: "p", text: "全部开放。[2]" },
  ]);
});

test("一级标题、有序列表、列表后接正文、英文续行补空格", () => {
  assert.deepEqual(parseMarkdown("# 标题\n1. 第一步\n2、第二步\n总结一句\nwith English\ntext"), [
    { type: "h", level: 1, text: "标题" },
    { type: "ol", items: ["第一步", "第二步"] },
    { type: "p", text: "总结一句with English text" },
  ]);
});

test("流式输出到一半时也能解析", () => {
  assert.deepEqual(parseMarkdown("## 背景\n正在写"), [{ type: "h", level: 2, text: "背景" }, { type: "p", text: "正在写" }]);
  assert.deepEqual(parseMarkdown("## 背"), [{ type: "h", level: 2, text: "背" }]);
  assert.deepEqual(parseMarkdown(""), []);
});

test("数字开头的正文不当成有序列表", () => {
  assert.deepEqual(parseMarkdown("1.5 万美元的训练成本\n2026年发布"), [{ type: "p", text: "1.5 万美元的训练成本2026年发布" }]);
});

test("单独一行的 [图n] 解析为配图，夹在正文里的不算", () => {
  assert.deepEqual(parseMarkdown("第一段\n[图2]\n见[图1]说明"), [
    { type: "p", text: "第一段" },
    { type: "img", n: 2 },
    { type: "p", text: "见[图1]说明" },
  ]);
});
