import type { StreamEvent } from "./protocol.ts";
import type { ChatMessage, LLMProvider } from "./providers/types.ts";

// 精简的 Agent 内核：模型每一步输出一个动作（JSON），程序校验后执行，结果作为观察喂回同一段对话，
// 直到某个动作给出结果或预算用完。研究循环（research.ts）与输入框路由（router.ts）都跑在这里。
// 自由在边界之内：动作集合固定、参数逐个校验、步数与时长有上限，模型输出不合法时按调用方给的兜底动作执行。

export interface AgentDeps {
  llm: LLMProvider;
  log: (msg: string, extra?: unknown) => void;
}

/** 动作执行完：observe 继续下一步（内容作为用户消息喂回），finish 结束循环 */
export type Outcome<R> = { observe: string } | { finish: R };

export interface Action<R, A = unknown> {
  /** 校验并归一化模型给出的参数（这一步的整个 JSON）；不合法返回 null */
  parse(input: Record<string, unknown>): A | null;
  run(args: A, step: number): AsyncGenerator<StreamEvent, Outcome<R>>;
}

export interface AgentSpec<R> {
  /** 写进调试日志的名字 */
  name: string;
  /** 初始对话：system 说明动作与输出格式，user 给出任务 */
  messages: ChatMessage[];
  // 每个动作的参数类型不同，注册表里统一按 unknown 存放，由各自的 parse / run 保证一致
  actions: Record<string, Action<R, any>>;
  budget: { maxSteps: number; maxMs?: number };
  /** 模型这一步的输出不是合法动作时改用的动作（参数同样会经过校验） */
  fallback(step: number, raw: string): { action: string } & Record<string, unknown>;
  /** 预算用完时的结果 */
  exhausted(): R;
  /** 每一步决策前给界面的提示（如阶段切换） */
  beforeStep?(step: number): StreamEvent | null;
  temperature?: number;
  /** 单次决策的时限，默认 DECIDE_MS */
  decideMs?: number;
}

/** 从模型输出里取出 JSON 对象；没有或不合法时返回 null */
export function readJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 单次决策的时限：平时约 3 秒，实测（2026-10）偶尔会卡 30 多秒才返回，超时按输出不合法处理、走兜底动作 */
export const DECIDE_MS = 12_000;

/** 一次决策：轻量模型、JSON 模式，思考过程流式转发给界面；超时返回空串 */
async function* decide(deps: AgentDeps, messages: ChatMessage[], temperature: number, signal: AbortSignal, limitMs: number): AsyncGenerator<StreamEvent, string> {
  let text = "";
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal.addEventListener("abort", stop);
  const timer = setTimeout(stop, limitMs);
  try {
    // 传副本：循环会继续往这段对话里追加消息
    for await (const d of deps.llm.stream([...messages], { tier: "fast", temperature, json: true, signal: ctrl.signal })) {
      if (d.reasoning) yield { type: "thinking", delta: d.reasoning };
      if (d.content) text += d.content;
    }
  } catch (err) {
    if (signal.aborted || !ctrl.signal.aborted) throw err;
    deps.log(`agent: decision timed out after ${limitMs}ms`);
    return "";
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
  return text.trim();
}

export async function* runAgent<R>(deps: AgentDeps, spec: AgentSpec<R>, signal: AbortSignal): AsyncGenerator<StreamEvent, R> {
  const messages = [...spec.messages];
  const started = Date.now();
  for (let step = 1; ; step++) {
    const hint = spec.beforeStep?.(step);
    if (hint) yield hint;
    const raw = yield* decide(deps, messages, spec.temperature ?? 0.2, signal, spec.decideMs ?? DECIDE_MS);
    messages.push({ role: "assistant", content: raw || "{}" });

    const json = readJson(raw);
    let name = typeof json?.action === "string" ? json.action : "";
    let args = json && spec.actions[name] ? spec.actions[name].parse(json) : null;
    if (args === null) {
      const fb = spec.fallback(step, raw);
      deps.log(`${spec.name}: step ${step} invalid action, fallback to ${fb.action}`, raw.slice(0, 300));
      name = fb.action;
      args = spec.actions[name]?.parse(fb);
      if (args === null || args === undefined) throw new Error(`${spec.name}: fallback action ${name} is invalid`);
    } else {
      deps.log(`${spec.name}: step ${step} ${name}`, raw.slice(0, 300));
    }

    const out = yield* spec.actions[name].run(args, step);
    if ("finish" in out) return out.finish;
    if (step >= spec.budget.maxSteps || (spec.budget.maxMs !== undefined && Date.now() - started > spec.budget.maxMs)) {
      deps.log(`${spec.name}: budget reached after ${step} steps`);
      return spec.exhausted();
    }
    messages.push({ role: "user", content: out.observe });
  }
}
