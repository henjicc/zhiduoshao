import assert from "node:assert/strict";
import { test } from "node:test";
import { textOf } from "../core/providers/types.ts";
import { dice } from "../lib/match.ts";
import { sitesIn, usedSites } from "./brief.ts";
import { consolidatePrompt, parseMemory } from "./consolidate.ts";
import { MEMORY_MAX, topAngles, topSites, type MemoryState } from "./store.ts";

test("整理提示词带上现有记忆与使用信号；模型输出去掉代码块围栏，空输出不能清空记忆", () => {
  const user = textOf(consolidatePrompt("- 喜欢详细的回答", {
    pending: [
      { kind: "ask", q: "2.5G 交换机怎么选", mapId: "m", at: 0 },
      { kind: "ask", q: "台风为什么秋天还有", mapId: "n", at: 0 },
      { kind: "detail", q: "主控芯片", mapId: "m", at: 0 },
    ],
    sites: [{ site: "php.net", count: 3 }],
    angles: [{ dir: "对比", rate: 0.5 }],
    maps: [{ id: "m", title: "交换机选购" }, { id: "x", title: "PHP 漏洞" }],
  })[1].content);
  assert.match(user, /现有记忆：\n- 喜欢详细的回答/);
  // 同一张地图里的追问放在一组、组名是地图标题；还没保存的新地图没有标题
  assert.match(user, /地图「交换机选购」：\n- 2\.5G 交换机怎么选\n- （打开详解深入阅读）主控芯片\n一张新地图：\n- 台风为什么秋天还有/);
  // 「其他地图」不重复列出上面已经分组的地图，免得同一张被算成两张
  assert.match(user, /其他最近探索过的地图（每行一张）：\nPHP 漏洞$/m);
  assert.doesNotMatch(user, /其他最近探索过的地图[\s\S]*交换机选购/);
  assert.match(user, /php\.net（3 次）/);
  assert.match(user, /对比（点击率 50%）/);
  assert.equal(parseMemory("```\n- 关注家用网络设备\n\n- 常看 php.net\n```"), "- 关注家用网络设备\n- 常看 php.net");
  assert.equal(parseMemory("   \n"), null);
  assert.equal(parseMemory("一".repeat(MEMORY_MAX + 50))!.length, MEMORY_MAX);
});

test("常看的网站与常点的角度有门槛；卡片只标记忆里写到、检索时真的限定过的站点", () => {
  const state = { sites: { "php.net": { count: 3, last: 0 }, "a.com": { count: 1, last: 0 } }, angles: { 对比: { shown: 6, clicked: 3, last: 0 }, 原因: { shown: 8, clicked: 1, last: 0 } } } as unknown as MemoryState;
  assert.deepEqual(topSites(state).map((s) => s.site), ["php.net"]);
  assert.deepEqual(topAngles(state).map((a) => a.dir), ["对比"]);
  assert.deepEqual(sitesIn("- 常看 www.php.net 和 GitHub.com\n- 关注 PHP 安全"), ["php.net", "github.com"]);
  assert.deepEqual(usedSites({ sites: ["php.net", "github.com"], recalls: [] }, ["PHP 漏洞 site:www.php.net", "PHP 漏洞"]), ["php.net"]);
});

test("历史问题相似度：去掉问句套话后比较，换个说法也能对上，只共享一个词的不算", () => {
  const strip = (q: string) => q.replace(/为什么|怎么|什么|最近|这么|了|吗/g, "");
  const a = dice(strip("内存条为什么最近涨价这么厉害？"), strip("为什么最近内存条突然涨价了？"));
  assert.ok(a.score >= 0.4 && a.common >= 3);
  assert.ok(dice("PHP 漏洞", "PHP 版本").common < 3);
});
