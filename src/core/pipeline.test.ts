import assert from "node:assert/strict";
import { test } from "node:test";
import { keepFullText, type NodeContext, type Source, type StreamEvent } from "./protocol.ts";
import { textOf, type ChatMessage, type ContentPart, type LLMProvider } from "./providers/types.ts";
import { parsePages, requestBody } from "./providers/yuanbao.ts";
import { answer, mergeSources } from "./pipeline.ts";
import { answerPrompt, READER_RULE, synthesizePrompt } from "./prompts.ts";
import { parseDrop, parseRead, parseSearch, perQuery } from "./research.ts";
import { command } from "./router.ts";

const src = (url: string): Source => ({ id: url, title: url, url, site: "s", snippet: "" });

test("合并来源时去重并改写各节点角标", () => {
  const nodes: NodeContext[] = [
    { q: "a", summary: "", sources: [src("u1"), src("u2")], points: [{ text: "p", cites: [2, 1] }] },
    { q: "b", summary: "", sources: [src("u2"), src("u3")], points: [{ text: "p", cites: [1, 2, 5] }] },
  ];
  const m = mergeSources(nodes);
  assert.deepEqual(m.sources.map((s) => s.url), ["u1", "u2", "u3"]);
  assert.deepEqual(m.nodes[0].points[0].cites, [2, 1]);
  assert.deepEqual(m.nodes[1].points[0].cites, [2, 3]); // 越界角标被丢弃
});

test("解析元宝搜索结果：跳过损坏条目、去重、补全站点名", () => {
  const pages = [
    JSON.stringify({ title: "标题一", url: "https://www.example.com/a", passage: "摘要", date: "2026-10-01" }),
    "{bad json",
    JSON.stringify({ title: "重复", url: "https://www.example.com/a" }),
    JSON.stringify({ title: "标题二", url: "https://b.cn/x", site: "B 站点", content: "动态摘要", passage: "标准摘要" }),
    JSON.stringify({ url: "https://c.cn" }),
  ];
  const out = parsePages(pages);
  assert.equal(out.length, 2);
  assert.equal(out[0].site, "example.com");
  assert.equal(out[1].snippet, "动态摘要");
});

/** 记录每次调用的档位与提示词的假模型 */
function fakeLLM(reply: (tier: string) => string) {
  const calls: { tier: string; messages: ChatMessage[] }[] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => "",
    async *stream(messages, opts = {}) {
      calls.push({ tier: opts.tier ?? "main", messages });
      yield { content: reply(opts.tier ?? "main") };
    },
  };
  return { llm, calls };
}

const collect = async (gen: AsyncGenerator<StreamEvent>) => { const out: StreamEvent[] = []; for await (const e of gen) out.push(e); return out; };
const lastText = (m: ChatMessage[]) => textOf(m[m.length - 1].content);

test("附图提问：先由视觉模型看图，描述进入回答提示词；已有描述时不再看图", async () => {
  const { llm, calls } = fakeLLM((tier) => (tier === "vision" ? "一张内存条价格截图" : "结论：涨了。"));
  const deps = { llm, search: null, log: () => {} };
  const req = { question: "这个贵吗？", path: [], existing: [], search: false, images: ["data:image/jpeg;base64,AAAA"] };
  const events = await collect(answer(deps, req, new AbortController().signal));
  assert.deepEqual(calls.map((c) => c.tier), ["vision", "main"]);
  const img = (calls[0].messages[1].content as ContentPart[]).find((p) => p.type === "image_url");
  assert.ok(img);
  assert.ok(events.some((e) => e.type === "vision" && e.text === "一张内存条价格截图"));
  assert.match(lastText(calls[1].messages), /一张内存条价格截图/);

  calls.length = 0;
  await collect(answer(deps, { ...req, imageNote: "已识别" }, new AbortController().signal));
  assert.deepEqual(calls.map((c) => c.tier), ["main"]);
});

test("模型能直接读图时不单独看图，图片原样放进回答提示词", async () => {
  const { llm, calls } = fakeLLM(() => "结论：涨了。");
  const deps = { llm: { ...llm, seesImages: true }, search: null, log: () => {} };
  const req = { question: "这个贵吗？", path: [], existing: [], search: false, images: ["data:image/jpeg;base64,AAAA"] };
  const events = await collect(answer(deps, req, new AbortController().signal));
  assert.deepEqual(calls.map((c) => c.tier), ["main"]);
  assert.ok(!events.some((e) => e.type === "stage" && e.stage === "see"));
  const parts = calls[0].messages[1].content as ContentPart[];
  assert.ok(parts.some((p) => p.type === "image_url"));
  assert.match(lastText(calls[0].messages), /用户附带了上面的图片[\s\S]*问题：这个贵吗？/);
});

test("search 动作（首轮）：兼容纯字符串、丢弃非法参数、来源数收回到范围内", () => {
  const plan = parseSearch({ queries: ["a", { q: "b", time: "m1", field: "news" }, { q: "c", time: "m99", field: "sports" }, { q: "a" }, "d", "e"], sources: 50 }, [], true);
  assert.deepEqual(plan, {
    queries: [{ q: "a" }, { q: "b", freshness: "m1", industry: "news" }, { q: "c" }, { q: "d" }],
    sources: 20,
  });
  assert.equal(parseSearch({ queries: ["x"] }, [], true)?.sources, 10);
  assert.equal(parseSearch({ queries: ["x"], sources: 2 }, [], true)?.sources, 5);
  assert.equal(parseSearch({ queries: [] }, [], true), null);
  assert.equal(parseSearch({}, [], true), null);
  // 补搜带上模型写的「还缺什么」，检索过程里显示；首轮不收
  assert.equal(parseSearch({ queries: ["y"], missing: " 缺少最近一年的判例 " }, ["x"], false)?.missing, "缺少最近一年的判例");
  assert.equal(parseSearch({ queries: ["y"], missing: "x" }, [], true)?.missing, undefined);
});

test("每个查询的条数按总量平分并取元宝档位", () => {
  assert.equal(perQuery(6, 1), 10);
  assert.equal(perQuery(20, 1), 30);
  assert.equal(perQuery(20, 4), 10);
  assert.equal(perQuery(20, 2), 20);
});

test("元宝请求体：带上时间与领域；极速版不发不支持的参数", () => {
  assert.deepEqual(requestBody("q", { count: 20, freshness: "d7", industry: "news" }, 10, "standard"), { Query: "q", Freshness: "d7", Cnt: 20, Mode: 2, Industry: "news" });
  assert.deepEqual(requestBody("q", { count: 20, freshness: "d7", industry: "news" }, 10, "lite"), { Query: "q", Freshness: "d7" });
  assert.deepEqual(requestBody("q", { count: 15 }, 10, null), { Query: "q", Cnt: 10, Mode: 2 });
  assert.equal(requestBody("q", {}, 10, "flagship").Deeplinks, true);
});

test("搜索更多来源：告诉改写阶段已搜过的词，已有来源在前、新来源去重后接在后面", async () => {
  const { llm, calls } = fakeLLM((tier) => (tier === "fast" ? '{"action":"search","queries":["新角度"],"sources":6}' : "结论：好。"));
  const searched: { q: string; count?: number }[] = [];
  const search = {
    name: "fake",
    search: async (q: string, opts: { count?: number } = {}) => { searched.push({ q, count: opts.count }); return [src("u1"), src("u3"), src("u4")]; },
  };
  const deps = { llm, search, log: () => {} };
  const req = { question: "问", path: [], existing: [], search: true, more: { queries: ["旧词"], sources: [src("u1"), src("u2")] } };
  const events = await collect(answer(deps, req, new AbortController().signal));
  assert.match(lastText(calls[0].messages), /已搜过：旧词/);
  assert.deepEqual(searched, [{ q: "新角度", count: 10 }]);
  const got = events.find((e) => e.type === "sources");
  assert.deepEqual(got?.type === "sources" && got.sources.map((s) => s.url), ["u1", "u2", "u3", "u4"]);
});

test("解析元宝搜索结果：配图、子链、权威度，以及没有链接的权威卡片", () => {
  const out = parsePages([
    JSON.stringify({
      title: "新闻", url: "https://a.cn/1", passage: "摘要", authority_level: 5,
      pics: [{ caption: "图一", origin_url: "https://img.cn/1.jpg" }, { caption: "坏", origin_url: "javascript:alert(1)" }],
      deeplinks: [{ title: "附件", url: "https://a.cn/1.pdf" }, { title: "", url: "https://a.cn/x" }],
    }),
    JSON.stringify({ title: "北京天气", content: "晴，12 到 20 度" }),
    JSON.stringify({ title: "北京天气", content: "重复" }),
    JSON.stringify({ title: "没有内容也没有链接" }),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].pics, [{ url: "https://img.cn/1.jpg", caption: "图一" }]);
  assert.deepEqual(out[0].links, [{ title: "附件", url: "https://a.cn/1.pdf" }]);
  assert.equal(out[0].authority, 5);
  assert.equal(out[0].card, undefined);
  assert.deepEqual([out[1].id, out[1].url, out[1].card], ["card:北京天气", "", true]);
});

test("search 动作（补搜）：跳过搜过的词，最多 2 个、新增 6 条", () => {
  assert.deepEqual(parseSearch({ queries: ["新词", "旧词", "新词", " ", { q: "带时间", time: "m1" }, "第三个"] }, ["旧词"], false), {
    queries: [{ q: "新词" }, { q: "带时间", freshness: "m1" }],
    sources: 6,
  });
  assert.equal(parseSearch({ queries: ["旧词"] }, ["旧词"], false), null);
});

test("检索循环：复查说不够就换词补搜，说够了就停，最多三轮", async () => {
  const reviews = ['{"action":"search","queries":["第二轮"]}', '{"action":"done"}'];
  const { llm, calls } = fakeLLM(() => "");
  let fastCalls = 0;
  llm.stream = async function* (messages, opts = {}) {
    calls.push({ tier: opts.tier ?? "main", messages });
    if (opts.tier !== "fast") return yield { content: "结论：好。" };
    yield { content: fastCalls++ === 0 ? '{"action":"search","queries":["第一轮"],"sources":6}' : reviews.shift() ?? '{"action":"done"}' };
  };
  const searched: string[] = [];
  const search = { name: "fake", search: async (q: string) => { searched.push(q); return [src(`${q}-1`), src(`${q}-2`)]; } };
  const events = await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  assert.deepEqual(searched, ["第一轮", "第二轮"]);
  assert.ok(events.some((e) => e.type === "stage" && e.stage === "review"));
  assert.deepEqual(events.filter((e) => e.type === "stage" && e.stage === "search").map((e) => e.type === "stage" && e.detail?.round), [1, 2]);
  // 每轮搜索上报返回条数（去重前），供界面显示元宝搜索的检索规模
  assert.deepEqual(events.filter((e) => e.type === "searched").map((e) => e.type === "searched" && e.results), [2, 2]);
  const last = events.filter((e) => e.type === "sources").pop();
  assert.deepEqual(last?.type === "sources" && last.sources.map((s) => s.url), ["第一轮-1", "第一轮-2", "第二轮-1", "第二轮-2"]);
  assert.match(lastText(calls.find((c) => c.tier === "main")!.messages), /第二轮-2/);

  // 复查一直说不够：到第三轮为止
  reviews.splice(0, reviews.length, '{"action":"search","queries":["a"]}', '{"action":"search","queries":["b"]}', '{"action":"search","queries":["c"]}');
  searched.length = 0; fastCalls = 0;
  await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  assert.equal(searched.length, 3);
});

test("检索规划：查询词多时来源总数随之增加", () => {
  assert.equal(parseSearch({ queries: ["a", "b", "c"], sources: 10 }, [], true)?.sources, 12);
  assert.equal(parseSearch({ queries: ["a", "b", "c", "d"], sources: 6 }, [], true)?.sources, 16);
  assert.equal(parseSearch({ queries: ["a"], sources: 6 }, [], true)?.sources, 6);
});

test("输入框路由：新方向去重并限量，其余情况按提问处理", async () => {
  const route = async (reply: string, input: string, existing: string[] = []) => {
    const { llm } = fakeLLM(() => reply);
    const events = await collect(command({ llm, log: () => {} }, { input, node: { q: "节点", summary: "" }, path: [], existing }, new AbortController().signal));
    return events.filter((e) => e.type === "ask" || e.type === "followup");
  };
  assert.deepEqual(await route('{"action":"branch","questions":[{"dir":"成本","q":"甲？"},{"dir":"很长很长的角度标签","q":"乙？"},{"dir":"x","q":"已有？"},{"q":""}]}', "再给几个", ["已有？"]), [
    { type: "followup", followup: { dir: "成本", q: "甲？" } },
    { type: "followup", followup: { dir: "延伸", q: "乙？" } },
  ]);
  assert.deepEqual(await route('{"action":"ask","question":"补全后的问题？"}', "它呢"), [{ type: "ask", question: "补全后的问题？" }]);
  assert.deepEqual(await route("坏掉的输出", "原话"), [{ type: "ask", question: "原话" }]);
  assert.deepEqual(await route('{"action":"branch","questions":[]}', "原话"), [{ type: "ask", question: "原话" }]);
});

test("检索循环是同一段对话：复查时看得到规划和上一轮的结果", async () => {
  const replies = ['{"action":"search","queries":["甲"],"sources":5}', '{"action":"search","missing":"缺数据","queries":["乙"]}', '{"action":"done"}'];
  const fast: ChatMessage[][] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => "",
    async *stream(messages, opts = {}) {
      if (opts.tier === "fast") { assert.equal(opts.json, true); fast.push(messages); yield { content: replies.shift() ?? '{"action":"done"}' }; }
      else yield { content: "结论：好。" };
    },
  };
  const search = { name: "fake", search: async (q: string) => [src(`${q}-1`)] };
  await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  assert.equal(fast.length, 3);
  assert.deepEqual(fast[1].map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.match(textOf(fast[1][3].content), /第 1 轮搜索结果[\s\S]*\[1\] 甲-1/);
  assert.deepEqual(fast[2].map((m) => m.role), ["system", "user", "assistant", "user", "assistant", "user"]);
  assert.match(textOf(fast[2][4].content), /缺数据/);
  assert.match(textOf(fast[2][5].content), /第 2 轮搜索结果[\s\S]*\[2\] 乙-1/);
});

test("read 动作：只收范围内、没读过、有链接的来源，每次最多 3 篇", () => {
  const sources = [src("u1"), { ...src("u2"), text: "已读" }, { ...src("u3"), url: "" }, src("u4"), src("u5"), src("u6")];
  assert.deepEqual(parseRead({ ids: [1, 2, 3, 9, 1, "4", 5, 6] }, sources, 4), [1, 4, 5]);
  assert.deepEqual(parseRead({ ids: [1, 4] }, sources, 1), [1]);
  assert.equal(parseRead({ ids: [2, 3] }, sources, 4), null);
  assert.equal(parseRead({ ids: [1] }, sources, 0), null);
  assert.equal(parseRead({}, sources, 4), null);
});

test("研究循环读全文：正文挂到来源上交给写答案，失败的告诉模型；没有读取器时 read 不可用", async () => {
  const replies = ['{"action":"search","queries":["甲"],"sources":5}', '{"action":"read","ids":[1,2],"reason":"要细节"}', '{"action":"done"}'];
  const fast: ChatMessage[][] = [];
  const main: ChatMessage[][] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => "",
    async *stream(messages, opts = {}) {
      if (opts.tier === "fast") { fast.push(messages); yield { content: replies.shift() ?? '{"action":"done"}' }; }
      else { main.push(messages); yield { content: "结论：好。" }; }
    },
  };
  const search = { name: "fake", search: async () => [src("https://a.cn/1"), src("https://a.cn/2")] };
  const reader = {
    read: async (url: string) => {
      if (url.endsWith("2")) throw new Error("网页返回 HTTP 403");
      return { title: "甲", text: "全文正文".repeat(50) };
    },
  };
  const events = await collect(answer({ llm, search, reader, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  assert.ok(events.some((e) => e.type === "stage" && e.stage === "fetch" && e.detail?.count === 2));
  const last = events.filter((e) => e.type === "sources").pop();
  assert.ok(last?.type === "sources" && last.sources[0].text?.startsWith("全文正文") && !last.sources[1].text);
  assert.match(textOf(fast[2][fast[2].length - 1].content), /\[1\][\s\S]*已读全文 200 字[\s\S]*\[2\][\s\S]*读取失败：网页返回 HTTP 403/);
  assert.match(lastText(main[0]), /已读全文\n全文正文/);
  // 系统提示里写了 read 动作；没有读取器时不写
  assert.match(textOf(fast[0][0].content), /"action":"read"/);
  fast.length = 0;
  replies.push('{"action":"search","queries":["甲"]}', '{"action":"read","ids":[1]}');
  await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  assert.doesNotMatch(textOf(fast[0][0].content), /"action":"read"/);
});

test("来源的配图描述进入写答案的材料：去重、截短、限量，没有配图不多一行", async () => {
  const pics = ["K线图", "K线图", "", "x".repeat(60), "c", "d", "e"].map((caption, i) => ({ url: `https://img.cn/${i}.jpg`, caption }));
  const { llm, calls } = fakeLLM((tier) => (tier === "fast" ? '{"action":"done"}' : "结论：好。"));
  const search = { name: "fake", search: async () => [{ ...src("https://a.cn"), pics }, src("https://b.cn")] };
  await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  const text = lastText(calls.find((c) => c.tier === "main")!.messages);
  assert.ok(text.includes(`配图：K线图；${"x".repeat(40)}；c；d
`));
  assert.equal(text.match(/配图：/g)?.length, 1);
});

test("search 动作的限定站点：拆出查询词里的 site:、去掉协议与路径、丢弃不合法的；同一查询词可分别限定不同站点", () => {
  const plan = parseSearch({ queries: [
    { q: "useEffect 清理函数", site: "https://react.dev/reference/react" },
    "useEffect 清理函数 site:juejin.cn",
    { q: "useEffect 清理函数", site: "不是域名" },
    { q: "社保 政策", site: "gov.cn" },
  ] }, [], true)!;
  // gov.cn 这类只有后缀的写法当作不限站点
  assert.deepEqual(plan.queries.map((p) => [p.q, p.site]), [["useEffect 清理函数", "react.dev"], ["useEffect 清理函数", "juejin.cn"], ["useEffect 清理函数", undefined], ["社保 政策", undefined]]);
  // 已搜过的按「查询词 site:域名」判重
  assert.equal(parseSearch({ queries: [{ q: "a", site: "github.com" }] }, ["a site:github.com"], false), null);
  assert.equal(requestBody("q", { site: "github.com" }, 10, "lite").Site, "github.com");
});

test("首轮全部限定站点时补一个全网查询；补不下就去掉最后一个的限定", () => {
  const one = parseSearch({ queries: [{ q: "a", site: "github.com" }] }, [], true)!;
  assert.deepEqual(one.queries.map((p) => p.site), ["github.com", undefined]);
  const full = parseSearch({ queries: ["a", "b", "c", "d"].map((q) => ({ q, site: "github.com" })) }, [], true)!;
  assert.deepEqual(full.queries.map((p) => p.site), ["github.com", "github.com", "github.com", undefined]);
});

test("看看新进展：所有查询统一限定时间范围、跳过上一层的来源；没查到新内容也按只用来源回答", async () => {
  const { llm, calls } = fakeLLM((tier) => (tier === "fast" ? '{"action":"search","queries":[{"q":"a","time":"y1"},{"q":"b"}]}' : "结论：没有。"));
  const seen: (string | undefined)[] = [];
  const search = { name: "fake", search: async (_q: string, opts: { freshness?: string } = {}) => { seen.push(opts.freshness); return [src("old")]; } };
  const req = { question: "问", path: [{ q: "上一层", summary: "旧结论" }], existing: [], search: true, since: "2026-10-16", exclude: ["old"] };
  const events = await collect(answer({ llm, search, log: () => {} }, req, new AbortController().signal));
  assert.ok(seen.length > 0 && seen.every((f) => f?.startsWith("2026-10-16,")));
  const last = events.filter((e) => e.type === "sources").pop();
  assert.deepEqual(last?.type === "sources" && last.sources, []);
  const system = textOf(calls.find((c) => c.tier === "main")!.messages[0].content);
  assert.match(system, /2026-10-16 以来没有查到新的进展/);
  assert.doesNotMatch(system, /本次没有联网搜索/);
});

test("简单问题：规划标 quick 时搜到结果就不复查，主模型思考降到 low；没搜到结果照常复查", async () => {
  const thinking: (string | undefined)[] = [];
  let fast = 0;
  const llm: LLMProvider = {
    name: "fake", complete: async () => "",
    async *stream(_m, opts = {}) {
      if (opts.tier === "fast") { fast++; yield { content: fast === 1 ? '{"action":"search","queries":["深圳 明天 天气"],"quick":true}' : '{"action":"done"}' }; return; }
      thinking.push(opts.effort);
      yield { content: "结论：晴。" };
    },
  };
  const search = { name: "fake", search: async () => [src("w")] };
  const events = await collect(answer({ llm, search, log: () => {} }, { question: "深圳明天天气", path: [], existing: [], search: true }, new AbortController().signal));
  assert.equal(fast, 1);
  assert.ok(!events.some((e) => e.type === "stage" && e.stage === "review"));
  assert.deepEqual(thinking, ["low"]);

  fast = 0; thinking.length = 0;
  const empty = { name: "fake", search: async () => [] as Source[] };
  await collect(answer({ llm, search: empty, log: () => {} }, { question: "深圳明天天气", path: [], existing: [], search: true }, new AbortController().signal));
  assert.equal(fast, 2);
  assert.deepEqual(thinking, [undefined]);
});

test("解析元宝 VR 卡（实测天气卡的结构）：识别类别，摘要去掉跳转地址行与行首 #", () => {
  const passage = "# 天气预报：深圳天气预报_一周天气预报\n# 天气跳转地址：https://h5.weatherol.com.cn/tqhome.html\n# 城市：深圳\n# 日级天气预报：\n\n日期：2026-10-20\n最高温度（摄氏度）：32";
  const [s] = parsePages([JSON.stringify({ vr: true, vr_category: "weather", vrid: "70269801", title: "深圳天气预报_一周天气预报", url: "https://h5.weatherol.com.cn/tqhome.html?cityid=440300", site: "气象在线", passage, date: "2026-10-19 21:39:54" })]);
  assert.equal(s.card, true);
  assert.equal(s.cardType, "weather");
  assert.equal(s.snippet, "天气预报：深圳天气预报_一周天气预报\n城市：深圳\n日级天气预报：\n\n日期：2026-10-20\n最高温度（摄氏度）：32");
});

test("回答偏好：时间范围限定所有查询，权威优先写进检索规划，风格写进回答提示词", async () => {
  const { llm, calls } = fakeLLM((tier) => (tier === "fast" ? '{"action":"search","queries":[{"q":"a","time":"y1"},{"q":"b"}],"quick":true}' : "结论：好。"));
  const seen: (string | undefined)[] = [];
  const search = { name: "fake", search: async (q: string, opts: { freshness?: string } = {}) => { seen.push(opts.freshness); return [src(q)]; } };
  const prefs = { style: "plain" as const, customStyle: "", sources: "official" as const, time: "d7" as const };
  await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true, prefs }, new AbortController().signal));
  assert.deepEqual(seen, ["d7", "d7"]);
  assert.match(textOf(calls.find((c) => c.tier === "fast")!.messages[0].content), /用户要求优先官方与权威来源/);
  assert.match(textOf(calls.find((c) => c.tier === "main")!.messages[0].content), /回答风格：通俗易懂/);
});

test("回答提示词按提问方式调整详略；用户自定义风格时以用户为准", () => {
  const system = (style?: "auto" | "concise" | "custom") =>
    answerPrompt("PHP 是啥", [], [], null, undefined, undefined, style && { style, customStyle: "一句话", sources: "auto", time: "auto" })[0].content as string;
  assert.ok(system().includes(READER_RULE));
  assert.ok(system("concise").includes(READER_RULE));
  assert.ok(!system("custom").includes(READER_RULE));
  // 自动风格不加详略要求；简洁明了才限制成一两句
  assert.ok(!system("auto").includes("回答风格"));
  assert.match(system("concise"), /回答风格：简洁明了/);
});

test("回答提示词带时效规则：以最新来源为准，没联网时提醒知识可能过时", () => {
  const src = [{ id: "a", n: 1, title: "t", url: "https://a.com", site: "a.com", snippet: "s", date: "2026-10-01" }] as unknown as Parameters<typeof answerPrompt>[3];
  const withSearch = answerPrompt("什么是大语言模型", [], [], src)[0].content as string;
  const offline = answerPrompt("什么是大语言模型", [], [], null)[0].content as string;
  assert.match(withSearch, /今天是 \d{4}-\d{2}-\d{2}/);
  assert.match(withSearch, /以发布时间最新的为准/);
  assert.match(offline, /知识可能已经过时/);
  assert.match(withSearch, /有追问时，至少一条指向这个话题当前的前沿/);
  // 不联网时没听说过的东西不能说成不存在（实测把已发布的产品说成「没有这款」）
  assert.match(offline, /不要断言它不存在/);
});

test("拆题的写法只加在探索的第一层，看看新进展与追问不加", () => {
  const system = (path: { q: string; summary: string }[], since?: string) => answerPrompt("手机卡了想换，但总觉得亏", path, [], null, undefined, since)[0].content as string;
  assert.match(system([]), /拆题：/);
  assert.doesNotMatch(system([{ q: "起点", summary: "s" }]), /拆题：/);
  assert.doesNotMatch(system([], "2026-10-01"), /拆题：/);
});

test("卡片长度只由风格决定一处：简洁、详细与默认各一套，读者判断不另写条数", () => {
  const system = (style?: "auto" | "concise" | "deep" | "plain") =>
    answerPrompt("PHP 是啥", [], [], null, undefined, undefined, style && { style, customStyle: "", sources: "auto", time: "auto" })[0].content as string;
  assert.match(system("concise"), /写 2 到 4 条，每条一句话/);
  assert.doesNotMatch(system("concise"), /4 到 6 条|一到三句/);
  assert.match(system("deep"), /写 4 到 6 条，每条两到三句/);
  assert.match(system("deep"), /三到五句/);
  for (const s of [undefined, "auto", "plain"] as const) assert.match(system(s), /按需要写 2 到 6 条[\s\S]*按入门读者答时写 4 到 6 条/);
  assert.doesNotMatch(READER_RULE, /\d 条/);
  // 自定义风格不带读者判断，也就没有入门读者的条数；综合没有读者判断，扩散按简洁写
  const custom = answerPrompt("PHP 是啥", [], [], null, undefined, undefined, { style: "custom", customStyle: "一句话", sources: "auto", time: "auto" })[0].content as string;
  assert.doesNotMatch(custom, /入门读者/);
  const synth = (op: "summary" | "expand") => synthesizePrompt(op, undefined, [], [], [], false, { style: "deep", customStyle: "", sources: "auto", time: "auto" })[0].content as string;
  assert.match(synth("summary"), /写 4 到 6 条，每条两到三句/);
  assert.doesNotMatch(synth("summary"), /入门读者/);
  assert.match(synth("expand"), /写 2 到 4 条，每条一句话/);
  assert.doesNotMatch(synth("expand"), /4 到 6 条|2 到 3 条|详细深入/);
});

test("检索中替换来源列表时保留阅读视图已读到的全文，新列表自己带的全文优先", () => {
  const prev = [{ ...src("a"), text: "阅读视图读到的全文" }, { ...src("b"), text: "旧全文" }, src("gone")];
  const next = [src("a"), { ...src("b"), text: "研究 Agent 读到的全文" }, src("c")];
  assert.deepEqual(keepFullText(prev, next).map((s) => [s.id, s.text]), [["a", "阅读视图读到的全文"], ["b", "研究 Agent 读到的全文"], ["c", undefined]]);
});

test("合并多个节点的来源时，同一篇文章换了网址也只占一个序号", () => {
  const snippet = "同一篇通稿的正文内容，被几家网站原样转载，开头一字不差，后面也完全一样，足够长才按摘要认作同一篇。".repeat(2);
  const nodes: NodeContext[] = [
    { q: "a", summary: "", sources: [{ ...src("https://a.cn/x"), snippet }, src("u2")], points: [{ text: "p", cites: [1, 2] }] },
    { q: "b", summary: "", sources: [{ ...src("https://b.cn/repost"), snippet }], points: [{ text: "p", cites: [1] }] },
  ];
  const m = mergeSources(nodes);
  assert.deepEqual(m.sources.map((s) => s.url), ["https://a.cn/x", "u2"]);
  assert.deepEqual(m.nodes[1].points[0].cites, [1]);
});

test("读全文：提取到的正文不比摘要长时不算全文，继续用摘要并告诉模型", async () => {
  const snippet = "搜索摘要里的完整说明".repeat(10);
  const replies = ['{"action":"search","queries":["甲"],"sources":5}', '{"action":"read","ids":[1]}', '{"action":"done"}'];
  const fast: ChatMessage[][] = [];
  const main: ChatMessage[][] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => "",
    async *stream(messages, opts = {}) {
      if (opts.tier === "fast") { fast.push(messages); yield { content: replies.shift() ?? '{"action":"done"}' }; }
      else { main.push(messages); yield { content: "结论：好。" }; }
    },
  };
  const search = { name: "fake", search: async () => [{ ...src("https://a.cn/1"), snippet }] };
  const reader = { read: async () => ({ title: "甲", text: "请登录后查看" }) };
  const events = await collect(answer({ llm, search, reader, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  const last = events.filter((e) => e.type === "sources").pop();
  assert.ok(last?.type === "sources" && !last.sources[0].text);
  assert.ok(events.some((e) => e.type === "read" && e.ok === 0));
  assert.match(textOf(fast[2][fast[2].length - 1].content), /读取失败：读到的正文只有 6 字，不比搜索摘要长/);
  assert.match(lastText(main[0]), new RegExp(snippet));
});

test("检索去重：同一篇文章换了网址（http 与 https、转载）只留一条；摘要太短时只按网址", async () => {
  const body = "国家网络安全通报中心发布预警，PHP 存在远程代码执行高危漏洞，影响多个版本，请尽快升级到修复版本。受影响的网站管理员应立即检查服务器配置。".repeat(2);
  const article = (url: string, extra = ""): Source => ({ ...src(url), snippet: body + extra });
  const lists: Record<string, Source[]> = {
    甲: [article("https://a.cn/x"), article("http://a.cn/x"), src("https://c.cn/short")],
    乙: [article("https://b.cn/repost", "（转载）"), src("https://d.cn/short"), article("https://a.cn/x")],
  };
  const { llm } = fakeLLM((tier) => (tier === "fast" ? '{"action":"search","queries":["甲","乙"],"sources":10,"quick":true}' : "结论：好。"));
  const search = { name: "fake", search: async (q: string) => lists[q] };
  const events = await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
  const last = events.filter((e) => e.type === "sources").pop();
  assert.deepEqual(last?.type === "sources" && last.sources.map((s) => s.url), ["https://a.cn/x", "https://d.cn/short", "https://c.cn/short"]);
  assert.ok(events.some((e) => e.type === "searched" && e.results === 6 && e.unique === 3));
});

test("复查可以剔除来源：drop 的序号不交给写答案、带理由报给界面；已有来源不能丢，全部丢掉时一条不丢", async () => {
  const run = async (done: string) => {
    const replies = ['{"action":"search","queries":["甲"],"sources":5}', done];
    const main: ChatMessage[][] = [];
    const llm: LLMProvider = {
      name: "fake",
      complete: async () => "",
      async *stream(messages, opts = {}) {
        if (opts.tier === "fast") yield { content: replies.shift() ?? '{"action":"done"}' };
        else { main.push(messages); yield { content: "结论：好。" }; }
      },
    };
    const search = { name: "fake", search: async () => [src("https://a.cn"), src("https://farm.cn"), src("https://c.cn")] };
    const events = await collect(answer({ llm, search, log: () => {} }, { question: "问", path: [], existing: [], search: true }, new AbortController().signal));
    const last = events.filter((e) => e.type === "sources").pop();
    const dropped = events.flatMap((e) => (e.type === "dropped" ? e.sources : []));
    return { urls: last?.type === "sources" ? last.sources.map((s) => s.url) : [], prompt: lastText(main[0]), dropped };
  };
  const kept = await run('{"action":"done","drop":[{"id":2,"why":"内容农场"}]}');
  assert.deepEqual(kept.urls, ["https://a.cn", "https://c.cn"]);
  assert.match(kept.prompt, /\[2\] https:\/\/c\.cn/);
  assert.doesNotMatch(kept.prompt, /farm\.cn/);
  assert.deepEqual(kept.dropped, [{ title: "https://farm.cn", site: "s", url: "https://farm.cn", why: "内容农场" }]);
  const all = await run('{"action":"done","drop":[1,2,3]}');
  assert.deepEqual(all.urls, ["https://a.cn", "https://farm.cn", "https://c.cn"]);
  assert.deepEqual(all.dropped, []);
  // 只写序号的不带理由；不认识的理由不显示；已有来源与越界的序号丢掉
  assert.deepEqual([...parseDrop({ drop: [1, 3, 3, 9, "x", { id: 4, why: "广告" }] }, 4, 2)], [[3, undefined], [4, undefined]]);
});
