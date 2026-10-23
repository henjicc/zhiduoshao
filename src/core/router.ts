import { runAgent, type AgentDeps, type AgentSpec } from "./agent.ts";
import { commandPrompt } from "./prompts.ts";
import type { CommandRequest, Followup, StreamEvent } from "./protocol.ts";

// 延伸列表底部的输入框：只走一步的 Agent，由轻量模型判断意图后选一个动作：
//   {"action":"ask","question":"补全后的问句"}           → 新建追问节点并回答
//   {"action":"branch","questions":[{"dir":"角度","q":"问句"}]} → 在当前节点下补充探索方向
// 以后要加「对比」「深挖」等能力，在 actions 里注册新动作即可。

export type Command = { action: "ask"; question: string } | { action: "branch"; questions: Followup[] };

const MAX_BRANCH = 6;

/** ask：拿不到改写后的问句时用原话 */
export function parseAsk(input: Record<string, unknown>, raw: string): Command {
  const q = typeof input.question === "string" ? input.question.trim() : "";
  return { action: "ask", question: q || raw.trim() };
}

/** branch：去掉空的和已有的问题，角度标签过长时用通用标签；一条可用的都没有时返回 null */
export function parseBranch(input: Record<string, unknown>, existing: string[]): Command | null {
  if (!Array.isArray(input.questions)) return null;
  const seen = new Set(existing);
  const questions: Followup[] = [];
  for (const item of input.questions) {
    const o = item as { dir?: unknown; q?: unknown } | null;
    const q = typeof o?.q === "string" ? o.q.trim() : "";
    if (!q || seen.has(q)) continue;
    seen.add(q);
    const dir = typeof o!.dir === "string" && o!.dir.trim() && o!.dir.trim().length <= 6 ? o!.dir.trim() : "延伸";
    questions.push({ dir, q });
  }
  return questions.length ? { action: "branch", questions: questions.slice(0, MAX_BRANCH) } : null;
}

/** 判断输入意图并产出事件：ask 事件交给界面新建追问节点，branch 逐条产出延伸问题 */
export async function* command(deps: AgentDeps, req: CommandRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const finish = async function* (cmd: Command) { return { finish: cmd }; };
  const spec: AgentSpec<Command> = {
    name: "router",
    messages: commandPrompt(req.input, req.node, req.path, req.existing),
    actions: {
      ask: { parse: (input) => parseAsk(input, req.input), run: finish },
      branch: { parse: (input) => parseBranch(input, req.existing), run: finish },
    },
    budget: { maxSteps: 1 },
    // 拿不准或输出不可用时按提问处理，用原话作为问题
    fallback: () => ({ action: "ask" }),
    exhausted: () => ({ action: "ask", question: req.input.trim() }),
    temperature: 0.3,
  };
  const cmd = yield* runAgent(deps, spec, signal);
  if (cmd.action === "ask") yield { type: "ask", question: cmd.question };
  else for (const f of cmd.questions) yield { type: "followup", followup: f };
  yield { type: "done" };
}
