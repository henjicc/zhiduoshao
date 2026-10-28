import { framedAnswer, genericAnswer, genericSources, isMemoryTopic, isThought, MEMORY_ANSWERS, MEMORY_SOURCES, topicOf } from "./mock-data.ts";
import { FRAME_MARK, VISION_MARK } from "../prompts.ts";
import { MEMORY_MARK } from "../../memory/consolidate.ts";
import { textOf, type ChatMessage, type LLMProvider, type SearchProvider } from "./types.ts";
import type { PageReader } from "./web.ts";

// 仅在配置显式选择 mock 时使用，用于无密钥时开发和调试界面。
// 示例模型读取编排层生成的提示词来组织输出，因此能反映真实的数据流向。

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/** 示例全文：稍等片刻后返回一段像样的正文 */
export function createMockReader(): PageReader {
  return {
    async read(url, signal) {
      await sleep(700, signal);
      const p = "这是示例网页的正文段落，用来在没有密钥时查看读取全文的流程。正文会比搜索摘要更完整，包含背景、数据和不同观点的细节。";
      return { title: url, text: Array.from({ length: 12 }, () => p).join("\n") };
    },
  };
}

export function createMockSearch(): SearchProvider {
  return {
    name: "mock",
    async search(query, opts = {}) {
      await sleep(900, opts.signal);
      return isMemoryTopic(query) ? MEMORY_SOURCES() : genericSources(query);
    },
  };
}

const stripCites = (s: string) => s.replace(/\[\d+\]/g, "");
const bare = (q: string) => q.replace(/[？?]$/, "");

/** 从提示词里取出「节点」列表：每个节点的问题、结论与第一条要点的角标 */
// 总结提示词的节点行是「- 问题」，综合提示词是「1. 问题」（其下的「- 」是要点）
function parseNodes(text: string, head: RegExp) {
  const out: { q: string; summary: string; cites: string }[] = [];
  for (const line of text.split("\n")) {
    const h = head.exec(line);
    if (h) { out.push({ q: h[1], summary: "", cites: "" }); continue; }
    const s = /^\s*结论：(.+)$/.exec(line);
    if (s && out.length) out[out.length - 1].summary = s[1];
    const p = /^\s*(?:·|-)\s.+?((?:\[\d+\])+)$/.exec(line);
    if (p && out.length && !out[out.length - 1].cites) out[out.length - 1].cites = p[1];
  }
  return out;
}

function summaryDoc(user: string) {
  const nodes = parseNodes(user.split("来源：")[0], /^-\s+(.+)$/);
  const hasSources = user.includes("来源：");
  const c = (s: string) => (hasSources ? s : "");
  const first = nodes[0];
  const lead = nodes.slice(0, 2).map((n) => n.summary.split(/[，。]/)[0]).join("；");
  return [
    `# ${bare(first?.q ?? "探索总结")}：全貌梳理`,
    "",
    `${lead}。${c(first?.cites ?? "")}`,
    ...nodes.slice(1, 5).flatMap((n) => ["", `## ${bare(n.q)}`, "", `${stripCites(n.summary)}${c(n.cites)}`]),
    "",
  ].join("\n");
}

function synthesis(system: string, user: string) {
  const nodes = parseNodes(user.split("已有问题：")[0].split("来源：")[0], /^\d+\.\s+(.+)$/);
  const cite = user.includes("来源：");
  const topics = nodes.map((n) => topicOf(n.q));
  const task = /任务：(.+)/.exec(system)?.[1] ?? "";
  const title =
    task.startsWith("找出") ? `${topics[0]}与${topics[1]}有什么关系？`
    : task.startsWith("在这些") ? `深入看：${topics.slice(0, 2).join("与")}`
    : task.startsWith("从这些") ? `从这 ${nodes.length} 个问题还能想到什么？`
    : task.startsWith("按用户") ? (/用户指令：(.+)/.exec(user)?.[1] ?? "按指令处理")
    : `${topics.slice(0, 2).join("、")}的整体结论`;
  const c = (s: string) => (cite ? s : "");
  return [
    `标题：${title}`,
    `结论：${nodes.map((n) => n.summary.split(/[，。]/)[0]).slice(0, 3).join("；")}。${c("[1][2]")}`,
    "要点：",
    ...nodes.slice(0, 4).map((n, i) => `- ${topics[i]}：${stripCites(n.summary).split("。")[0]}。${c(n.cites)}`),
    "追问：",
    `[为什么] 它们背后有没有共同的原因？`,
    `[进展] 接下来最值得关注的变化是什么？`,
    `[争议] 哪些说法之间存在冲突？`,
  ].join("\n");
}

function answerText(system: string, user: string) {
  const q = /问题：(.+)/.exec(user)?.[1]?.trim() ?? "这个问题";
  const cite = user.includes("搜索结果：");
  // 起点是念头时像真实模型一样先拆题
  if (system.includes(FRAME_MARK) && isThought(q)) return framedAnswer(q, cite);
  const canned = MEMORY_ANSWERS[q];
  const text = canned ? (cite ? canned : stripCites(canned)) : genericAnswer(q, cite);
  // 顺着问到第三层时示例模型认为问透了，便于开发时看到收尾记号
  const depth = /探索路径（从起点到上一层）：\n((?:- .*\n?)+)/.exec(user)?.[1].trim().split("\n").length ?? 0;
  return depth >= 2 ? text.replace(/追问：[\s\S]*$/, "追问：无") : text;
}

/** 示例的记忆整理：保留现有记忆，把近期第一个提问的话题补成一条关注领域 */
function memoryPlan(user: string) {
  const current = /现有记忆：\n([\s\S]*?)\n\n/.exec(user)?.[1] ?? "";
  const ask = /^\d+\. (?:（[^）]*）)?(.+)$/m.exec(user)?.[1] ?? "这个话题";
  const line = `- 长期关注：${topicOf(ask).slice(0, 12)}`;
  const kept = current === "（空）" ? [] : current.split("\n").filter(Boolean);
  return [...kept.filter((l) => l !== line), line].join("\n");
}

/** 研究循环是同一段对话：第一条用户消息是问题（规划检索），之后的用户消息是每轮搜索结果（复查） */
const isResearch = (system: string) => system.includes("搜索引擎查询词");
const isReview = (user: string) => /第 \d+ 轮搜索结果/.test(user);
const questionOf = (messages: ChatMessage[]) => /问题：(.+)/.exec(textOf(messages[1]?.content ?? ""))?.[1] ?? "";

const isVision = (system: string) => system.includes(VISION_MARK);

/** 示例看图结果：按图片数量给出一段像样的描述 */
function visionText(messages: ChatMessage[]) {
  const user = messages[messages.length - 1].content;
  const n = typeof user === "string" ? 0 : user.filter((p) => p.type === "image_url").length;
  const one = (i: number) => `${n > 1 ? `图${i + 1}：` : ""}一张手机拍摄的电商页面截图，标题为“DDR5 6000 32GB 台式机内存条”，页面显示到手价 899 元，旁边标注“近 30 天最低价 649 元”，价格走势图在最近两个月明显上扬。`;
  return Array.from({ length: Math.max(1, n) }, (_, i) => one(i)).join("\n");
}

function respond(messages: ChatMessage[]) {
  const system = textOf(messages[0].content);
  const user = textOf(messages[messages.length - 1].content);
  if (isVision(system)) return visionText(messages);
  if (isResearch(system)) {
    const t = topicOf(questionOf(messages));
    // 复查：第 1 轮后认为不够、补搜一轮，之后就够了，便于开发时看到检索循环
    // 复查：第 1 轮后补搜一轮，第 2 轮后读两篇全文，读完就够了，便于开发时看到完整的检索循环
    if (user.startsWith("全文读取结果")) return '{"action":"done"}';
    if (isReview(user)) {
      if (user.startsWith("第 1 轮")) return JSON.stringify({ action: "search", missing: "缺少具体数据", queries: [{ q: `${t} 数据` }] });
      return system.includes('"action":"read"') ? JSON.stringify({ action: "read", ids: [1, 2], reason: "摘要不够具体" }) : '{"action":"done"}';
    }
    return JSON.stringify({ action: "search", queries: [{ q: t, field: "news" }, { q: `${t} 最新`, time: "m1" }, { q: `${t} 官方说明`, site: "example.com" }] });
  }
  if (system.includes("打开详情页")) return detailDoc(user);
  // 输入意图：提到「几个、角度、方向」时给出新的探索方向，其余按提问处理
  if (system.includes("你来判断该怎么处理")) {
    const input = /用户输入：(.+)/.exec(user)?.[1] ?? "";
    const t = topicOf(/当前节点：(.+)/.exec(user)?.[1] ?? input);
    if (/几个|角度|方向|更多/.test(input)) {
      return JSON.stringify({ action: "branch", questions: [
        { dir: "成本", q: `${t}的成本主要花在哪？` },
        { dir: "对比", q: `${t}和传统方案差在哪？` },
        { dir: "风险", q: `${t}最大的风险是什么？` },
      ] });
    }
    return JSON.stringify({ action: "ask", question: input });
  }
  if (/^# 标题/m.test(system)) return summaryDoc(user);
  if (system.includes("标题：<")) return synthesis(system, user);
  return answerText(system, user);
}

/** 模拟思维链：按任务给出一段像样的思考过程，用于开发时查看等待动画 */
function thinking(messages: ChatMessage[]) {
  const system = textOf(messages[0].content);
  const user = textOf(messages[messages.length - 1].content);
  // 视觉模型没有思维链
  if (isVision(system)) return "";
  const q = /问题：(.+)/.exec(user)?.[1] ?? "这些节点";
  const t = topicOf(q);
  if (isResearch(system)) {
    if (isReview(user)) return `看一下这一轮的结果：已经覆盖了基本背景，但还缺具体数据，再补一轮。`;
    return `用户问的是「${q}」。核心对象是${t}，需要找的是原因和最新情况。搜索词要短，去掉口语化的部分，保留主体和关键动词；再补一个带“最新”的版本，覆盖近期报道。`;
  }
  const n = (user.match(/^\[\d+\]/gm) ?? []).length;
  return [
    `先看问题：${q}。用户想知道的是${t}背后的原因，以及现在的状况。`,
    n ? `搜索结果一共有 ${n} 条。第 1 条和第 2 条讲的是同一件事的两个侧面，可以互相印证；第 3 条给了具体数据，适合放进要点；后面几条偏背景，可以用来补充。` : "这次没有搜索结果，只能基于已有知识回答，不标注来源。",
    "有一处说法在不同来源里不完全一致，结论里要写得克制一些，不下绝对判断。",
    "结论控制在两句话以内，先给直接答案，再给最关键的原因。要点按重要程度排，每条都要能找到出处。",
    "追问要从不同方向展开：原因、最新进展、相关方、争议，避免和已有问题重复。",
  ].join("");
}

async function* typeOut(text: string, key: "content" | "reasoning", signal?: AbortSignal) {
  for (let i = 0; i < text.length; ) {
    const n = 2 + Math.floor(Math.random() * 3);
    await sleep(key === "reasoning" ? 16 : 22, signal);
    yield { [key]: text.slice(i, i + n) };
    i += n;
  }
}

export function createMockLLM(): LLMProvider {
  return {
    name: "mock",
    async complete(messages, opts = {}) {
      await sleep(400, opts.signal);
      return textOf(messages[0].content).includes(MEMORY_MARK) ? memoryPlan(textOf(messages[1].content)) : "好";
    },
    async *stream(messages, opts = {}) {
      await sleep(300, opts.signal);
      yield* typeOut(thinking(messages), "reasoning", opts.signal);
      yield* typeOut(respond(messages), "content", opts.signal);
    },
  };
}

/** 示例详解：按 Markdown 子集给出几节展开内容 */
function detailDoc(user: string) {
  const q = /问题：(.+)/.exec(user)?.[1] ?? "这个问题";
  const t = topicOf(q);
  const cite = /^\[\d+\]/m.test(user);
  const c = (n: number) => (cite ? `[${n}]` : "");
  return [
    `## 背景与原因`,
    `${t}之所以受到关注，核心在于成本、规模和政策三方面同时发生了变化。${c(1)}不同机构对变化速度的判断并不一致，但方向基本相同。${c(2)}`,
    // 有可用配图时像真实模型一样在相关段落后插一张
    ...(user.includes("可用配图") ? ["[图1]"] : []),
    `## 具体怎么做`,
    `- 先弄清楚${t}涉及的基本概念和关键指标。${c(1)}`,
    `- 再对比两到三个代表性案例，看它们的差异来自哪里。${c(3)}`,
    `- 最后结合自己的情况，挑一个最小可行的切入点开始。`,
    `## 需要注意的地方`,
    `部分说法缺少原始数据支撑，引用前最好回到来源核对口径和时间。${c(2)}`,
  ].join("\n\n");
}
