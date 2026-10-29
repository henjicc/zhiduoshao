import { debugLog, DEBUG_LOG, tracedFetch } from "../core/debug.ts";
import { httpFetch } from "../core/http.ts";
import { answer, detail, summarize, synthesize, type Deps } from "../core/pipeline.ts";
import { command } from "../core/router.ts";
import type { AnswerRequest, CommandRequest, DetailRequest, Stage, StreamEvent, SummaryRequest, SynthesizeRequest } from "../core/protocol.ts";
import { createProviders } from "../core/providers/registry.ts";
import { createMockReader } from "../core/providers/mock.ts";
import { createPageReader } from "../core/providers/web.ts";
import { ProviderError, type ChatMessage } from "../core/providers/types.ts";
import { MOCK_MODE, useSettings } from "../settings/store.ts";

// 编排在应用内执行；这里负责按当前设置创建供应商，并把异常统一转成 error 事件。

type Run<T> = (deps: Deps, req: T, signal: AbortSignal) => AsyncGenerator<StreamEvent>;

/** 调试日志里一次运行的汇总：模型解析后的结构化结果 */
function collector() {
  const r = { stages: [] as string[], queries: [] as string[], sources: [] as string[], title: "", summary: "", text: "", thinkingChars: 0, points: [] as unknown[], visual: null as unknown, followups: [] as unknown[] };
  return {
    add(ev: StreamEvent) {
      if (!DEBUG_LOG) return;
      if (ev.type === "stage") { r.stages.push(ev.stage); if (ev.detail?.queries) r.queries = ev.detail.queries; }
      else if (ev.type === "sources") r.sources = ev.sources.map((x) => `${x.site} | ${x.title} | ${x.url}`);
      else if (ev.type === "title") r.title = ev.text;
      else if (ev.type === "summary") r.summary += ev.delta;
      else if (ev.type === "text") r.text += ev.delta;
      else if (ev.type === "thinking") r.thinkingChars += ev.delta.length;
      else if (ev.type === "point") r.points.push(ev.point);
      else if (ev.type === "visual") r.visual = ev.visual;
      else if (ev.type === "followup") r.followups.push(ev.followup);
    },
    result: () => r,
  };
}

type Delta = Extract<StreamEvent, { delta: string }>;
const isDelta = (e: StreamEvent): e is Delta => e.type === "summary" || e.type === "text" || e.type === "thinking";

/**
 * 交给界面的事件：文字增量（结论、正文、思考）每个只有一两个字，同一帧里收到的合并成一次再交出去。
 * 每交出一次界面就整体提交一次（重排画布、重渲染越写越长的正文）；逐字交出时模型吐字一快主线程就处理不完，
 * 读流被拖慢、积压成大块，整页一直卡到生成完。其他事件交出前先交出攒着的增量，顺序不变；取消后攒着的直接丢掉
 */
function perFrame(onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  let pending: Delta | null = null;
  let frame = 0;
  const flush = () => {
    cancelAnimationFrame(frame);
    const p = pending;
    pending = null;
    if (p && !signal.aborted) onEvent(p);
  };
  const emit = (ev: StreamEvent) => {
    if (!isDelta(ev)) {
      flush();
      return onEvent(ev);
    }
    if (pending?.type === ev.type) {
      pending = { ...pending, delta: pending.delta + ev.delta };
      return;
    }
    flush();
    pending = { ...ev };
    frame = requestAnimationFrame(flush);
  };
  return { emit, flush };
}

async function run<T>(kind: string, fn: Run<T>, req: T, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const { emit, flush } = perFrame(onEvent, signal);
  let stage: Stage | undefined;
  const id = `${kind}-${Date.now().toString(36)}`;
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const out = collector();
  debugLog({ run: id, type: "run.start", kind, request: req });
  try {
    const s = useSettings.getState();
    const { llm, search, reader } = createProviders({ searchKey: s.searchKey, llmKey: s.llmKey, model: s.model, mock: MOCK_MODE, fetch: tracedFetch(httpFetch, id), pageFetch: httpFetch });
    const deps: Deps = {
      llm, search, reader,
      log: (m, x) => { console.info(`[${id}] ${m}`, x ?? ""); debugLog({ run: id, type: "run.note", message: m, extra: x }); },
    };
    for await (const ev of fn(deps, req, signal)) {
      if (signal.aborted) return debugLog({ run: id, type: "run.cancelled", ms: ms() });
      if (ev.type === "stage") stage = ev.stage;
      out.add(ev);
      emit(ev);
    }
    // 流结束时攒着的最后一段马上交出：页面隐藏时不会有下一帧来交
    flush();
    debugLog({ run: id, type: "run.done", ms: ms(), result: out.result() });
  } catch (err) {
    if (signal.aborted) return debugLog({ run: id, type: "run.cancelled", ms: ms() });
    if (err instanceof ProviderError) {
      console.warn(`[${id}] ${err.provider} failed at ${stage ?? "start"}: ${err.message}`, err.detail ?? "");
      debugLog({ run: id, type: "run.error", ms: ms(), stage, provider: err.provider, kind: err.kind, message: err.message, detail: err.detail, partial: out.result() });
      emit({ type: "error", stage, message: err.message, code: err.kind, hint: err.info?.hint });
    } else {
      console.error(`[${id}] unexpected error at ${stage ?? "start"}`, err);
      debugLog({ run: id, type: "run.error", ms: ms(), stage, message: String(err), stack: (err as Error)?.stack, partial: out.result() });
      emit({ type: "error", stage, message: "出现了意外错误，请重试" });
    }
  }
}

export const api = {
  answer: (req: AnswerRequest, on: (e: StreamEvent) => void, signal: AbortSignal) => run("answer", answer, req, on, signal),
  synthesize: (req: SynthesizeRequest, on: (e: StreamEvent) => void, signal: AbortSignal) => run("synth", synthesize, req, on, signal),
  summary: (req: SummaryRequest, on: (e: StreamEvent) => void, signal: AbortSignal) => run("summary", summarize, req, on, signal),
  command: (req: CommandRequest, on: (e: StreamEvent) => void, signal: AbortSignal) => run("command", command, req, on, signal),
  detail: (req: DetailRequest, on: (e: StreamEvent) => void, signal: AbortSignal) => run("detail", detail, req, on, signal),
};

/** 后台的一次性小任务（整理记忆）：快速模型、不流式，失败返回 null，不打扰用户 */
export async function completeFast(kind: string, messages: ChatMessage[]): Promise<string | null> {
  const id = `${kind}-${Date.now().toString(36)}`;
  debugLog({ run: id, type: "run.start", kind, request: { messages } });
  try {
    const s = useSettings.getState();
    if (!MOCK_MODE && !s.llmKey) return null;
    const { llm } = createProviders({ searchKey: s.searchKey, llmKey: s.llmKey, model: s.model, mock: MOCK_MODE, fetch: tracedFetch(httpFetch, id), pageFetch: httpFetch });
    const text = await llm.complete(messages, { tier: "fast", temperature: 0.2 });
    debugLog({ run: id, type: "run.done", result: { text } });
    return text;
  } catch (err) {
    console.warn(`[${id}] failed`, err);
    debugLog({ run: id, type: "run.error", message: String(err) });
    return null;
  }
}

/** 侧边栏阅读视图读取网页全文：不需要模型密钥；示例模式用示例正文 */
export function readPage(url: string, signal: AbortSignal) {
  const reader = MOCK_MODE ? createMockReader() : createPageReader(httpFetch);
  return reader.read(url, signal);
}
