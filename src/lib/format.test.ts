import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeTime, sourceMeta } from "./format.ts";
import type { Source } from "../core/protocol.ts";

const now = new Date(2026, 9, 24, 9, 30).getTime();

test("来源时间：带具体时刻的显示到分钟，只有日期的按天显示", () => {
  assert.equal(relativeTime("2026/10/24 08:05:12", now), "今天 08:05");
  assert.equal(relativeTime("2026/10/23 23:40:00", now), "昨天 23:40");
  assert.equal(relativeTime("2026/10/19 21:39:54", now), "10月19日 21:39");
  assert.equal(relativeTime("2025/12/31 10:00:00", now), "2025年12月31日 10:00");
  assert.equal(relativeTime("2026/10/24 00:00:00", now), "今天");
  assert.equal(relativeTime("2026/10/21 00:00:00", now), "3 天前");
  assert.equal(relativeTime("2024/12/25 00:00:00", now), "2024/12/25");
  assert.equal(relativeTime("2026/10/25 08:00:00", now), null);
});

test("卡片时效取最新一条来源的发布时间", () => {
  const s = (date: string) => ({ id: date, title: "", url: "", site: "", snippet: "", date }) as Source;
  const text = sourceMeta([s("2026/10/16 00:00:00"), s(new Date(Date.now() - 5 * 60_000).toISOString())]);
  assert.match(text, /^2 个来源，最新信息发布于(今天|昨天) \d\d:\d\d$/);
});
