import type { AnswerRequest, DetailRequest, NodeContext, Prefs, Source, StreamEvent, SummaryRequest, SynthesizeRequest } from "./protocol.ts";
import { ProviderError, type LLMProvider } from "./providers/types.ts";
import { AnswerParser } from "./format.ts";
import { answerPrompt, detailPrompt, summaryPrompt, synthesizePrompt, today, visionPrompt } from "./prompts.ts";
import { research, type ResearchDeps } from "./research.ts";
import { candidatePics } from "../lib/pics.ts";

// 一次请求的编排：看图 → 研究（research.ts 的 Agent 循环）→ 主模型整理答案；以及综合、总结、详解。
// 输入框路由在 router.ts。

/** 编排依赖：模型、搜索与日志（研究 Agent 用到的同一组） */
export type Deps = ResearchDeps;

/** 用户选的时间范围（近一周 / 近一个月）；自动时交给研究 Agent 按问题判断 */
const prefsFreshness = (prefs?: Prefs) => (prefs && prefs.time !== "auto" ? prefs.time : undefined);

/** 看图：视觉模型把图片转成文字。描述本身流式转发为 thinking，让等待时能看到模型在读图 */
async function* see(deps: Deps, question: string, images: string[], signal: AbortSignal): AsyncGenerator<StreamEvent, string> {
  let text = "";
  for await (const d of deps.llm.stream(visionPrompt(question, images), { tier: "vision", temperature: 0.2, signal })) {
    const delta = d.content ?? d.reasoning;
    if (delta) yield { type: "thinking", delta };
    if (d.content) text += d.content;
  }
  if (!text.trim()) throw new ProviderError("tokenhub", "图片识别没有返回内容", undefined, "other", { hint: "视觉模型没有输出描述，请换一张更清晰的图片再试" });
  return text.trim();
}

/** 主模型整理答案；简单问题（快速路径）思考降到 low（混元时代实测思考要写约 2000 字、占整次回答的大部分时间；用户要求不完全关掉） */
async function* compose(deps: Deps, messages: Parameters<LLMProvider["stream"]>[0], sourceCount: number, signal: AbortSignal, thinking = true): AsyncGenerator<StreamEvent> {
  const parser = new AnswerParser(sourceCount);
  for await (const d of deps.llm.stream(messages, thinking ? { signal } : { signal, effort: "low" })) {
    if (d.reasoning) yield { type: "thinking", delta: d.reasoning };
    if (d.content) yield* parser.push(d.content);
  }
  yield* parser.flush();
}

export async function* answer(deps: Deps, req: AnswerRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  let sources: Source[] | null = null;
  let note = req.imageNote;
  // 模型能直接读图时图片原样交给研究与回答；否则先由视觉模型转成文字（存到节点上，重试时不再识别）
  const images = req.images?.length && !note && deps.llm.seesImages ? req.images : undefined;
  if (req.images?.length && !note && !images) {
    yield { type: "stage", stage: "see", detail: { count: req.images.length } };
    note = yield* see(deps, req.question, req.images, signal);
    yield { type: "vision", text: note };
  }
  // 看看新进展按日期区间；否则用用户选的时间范围
  const freshness = req.since ? `${req.since},${today()}` : prefsFreshness(req.prefs);
  const official = req.prefs?.sources === "official";
  let quick = false;
  if (req.search) {
    ({ sources, quick } = yield* research(deps, req.question, req.path, signal, { note, images, known: req.more?.sources, searched: req.more?.queries, freshness, exclude: req.exclude, official, memory: req.memory?.research }));
    yield { type: "stage", stage: "read", detail: { count: sources.length } };
  }
  yield { type: "stage", stage: "compose" };
  // 看看新进展没查到新内容时也按「只用来源」回答，让模型如实说没有新进展，而不是凭记忆补
  const material = sources?.length || (req.since && sources) ? sources : null;
  yield* compose(deps, answerPrompt(req.question, req.path, req.existing, material, note, req.since, req.prefs, req.memory, images), sources?.length ?? 0, signal, !quick);
  yield { type: "done" };
}

/** 合并多个节点的来源并把各节点的角标改写为合并后的序号 */
export function mergeSources(nodes: NodeContext[]) {
  const sources: Source[] = [];
  const index = new Map<string, number>();
  const remapped = nodes.map((n) => {
    const local = n.sources.map((s) => {
      if (!index.has(s.id)) {
        sources.push(s);
        index.set(s.id, sources.length);
      }
      return index.get(s.id)!;
    });
    return { ...n, points: n.points.map((p) => ({ ...p, cites: p.cites.map((c) => local[c - 1]).filter(Boolean) })) };
  });
  return { sources, nodes: remapped };
}

export async function* synthesize(deps: Deps, req: SynthesizeRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const merged = mergeSources(req.nodes);
  let sources = merged.sources;
  if (req.search && (req.op === "deepen" || req.op === "custom")) {
    const topic = req.op === "custom" && req.instruction ? `${req.instruction}（${req.nodes.map((n) => n.q).join("；")}）` : req.nodes.map((n) => n.q).join("；");
    ({ sources } = yield* research(deps, topic, [], signal, { known: sources, freshness: prefsFreshness(req.prefs), official: req.prefs?.sources === "official" }));
  } else {
    yield { type: "sources", sources };
  }
  yield { type: "stage", stage: "read", detail: { count: sources.length } };
  yield { type: "stage", stage: "compose" };
  yield* compose(deps, synthesizePrompt(req.op, req.instruction, merged.nodes, sources, req.existing, req.search, req.prefs), sources.length, signal);
  yield { type: "done" };
}

export async function* summarize(deps: Deps, req: SummaryRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const merged = mergeSources(req.nodes);
  yield { type: "sources", sources: merged.sources };
  yield { type: "stage", stage: "compose" };
  for await (const d of deps.llm.stream(summaryPrompt(merged.nodes, merged.sources), { signal })) {
    if (d.reasoning) yield { type: "thinking", delta: d.reasoning };
    if (d.content) yield { type: "text", delta: d.content };
  }
  yield { type: "done" };
}

/** 详解：主模型按 Markdown 子集流式输出，引用节点已有的来源序号 */
export async function* detail(deps: Deps, req: DetailRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  yield { type: "stage", stage: "compose" };
  for await (const d of deps.llm.stream(detailPrompt(req.question, req.path, req.node, candidatePics(req.node.sources), req.prefs), { signal })) {
    if (d.reasoning) yield { type: "thinking", delta: d.reasoning };
    if (d.content) yield { type: "text", delta: d.content };
  }
  yield { type: "done" };
}
