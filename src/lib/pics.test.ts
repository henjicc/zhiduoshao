import assert from "node:assert/strict";
import { test } from "node:test";
import type { Source } from "../core/protocol.ts";
import { candidatePics, MAX_CANDIDATES } from "./pics.ts";

const src = (id: string, captions: string[]): Source => ({
  id, title: id, url: `https://${id}.cn`, site: id, snippet: "",
  pics: captions.map((caption, i) => ({ url: `https://${id}.cn/${i}.jpg`, caption })),
});

test("候选配图：去掉截图、标志等无信息量的图和过短的描述，每个来源先取一张、按顺序编号", () => {
  const pics = candidatePics([
    src("a", ["人民网首页截图", "延迟退休年龄对照表", "养老金计算公式示意"]),
    src("b", ["Logo", "国新办发布会现场"]),
    src("c", ["图", "二维码"]),
  ]);
  assert.deepEqual(pics.map((p) => [p.n, p.caption, p.source]), [
    [1, "延迟退休年龄对照表", 1],
    [2, "国新办发布会现场", 2],
    [3, "养老金计算公式示意", 1],
  ]);
});

test("候选配图：重复的图或描述只留一张，总数有上限", () => {
  const many = Array.from({ length: 12 }, (_, i) => src(`s${i}`, [`第 ${i} 张数据图表`, "同一张发布会现场图"]));
  const pics = candidatePics(many);
  assert.equal(pics.length, MAX_CANDIDATES);
  assert.equal(pics.filter((p) => p.caption === "同一张发布会现场图").length, 0); // 第一轮已取满
  assert.deepEqual(candidatePics([src("x", ["发布会现场照片"]), src("y", ["发布会现场照片"])]).length, 1);
});
