import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPhrase, splitPhrases } from "./smoothText.ts";

test("分段：遇到标点或满 6 个字断开，拼回去和原文一致", () => {
  const text = "PHP 是一种在服务器上运行的脚本语言，专门用来生成网页。";
  const ps = splitPhrases(text);
  assert.equal(ps.join(""), text);
  assert.ok(ps.every((p) => p.length <= 7));
  assert.ok(ps.some((p) => p.endsWith("，")));
});

test("分段不切在引用角标和加粗中间", () => {
  const text = "它运行在服务器上。[1][2]用来生成**动态网页**内容";
  const ps = splitPhrases(text);
  assert.equal(ps.join(""), text);
  assert.ok(ps.some((p) => p.includes("。[1][2]")));
  assert.ok(ps.some((p) => p.includes("**动态网页**")));
  assert.ok(ps.every((p) => !/\[\d*$/.test(p)));
});

test("还没写完时，不够一段的尾巴和半个角标先留着", () => {
  assert.equal(nextPhrase("你好", 0, false), null);
  assert.equal(nextPhrase("你好", 0, true), "你好");
  assert.equal(nextPhrase("结论[1", 0, false), null);
  assert.equal(nextPhrase("结论，后面", 0, false), "结论，");
});
