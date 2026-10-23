import assert from "node:assert/strict";
import { test } from "node:test";
import { readJson, runAgent, type AgentSpec } from "./agent.ts";
import type { StreamEvent } from "./protocol.ts";
import type { LLMProvider } from "./providers/types.ts";

/** 按顺序回放模型输出的假模型，记录每次请求的选项 */
function scripted(replies: string[]) {
  const opts: { tier?: string; json?: boolean }[] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => "",
    async *stream(_messages, o = {}) {
      opts.push(o);
      yield { content: replies.shift() ?? "" };
    },
  };
  return { llm, opts };
}

async function run<R>(spec: AgentSpec<R>, replies: string[]) {
  const { llm, opts } = scripted(replies);
  const logs: string[] = [];
  const gen = runAgent({ llm, log: (m) => logs.push(m) }, spec, new AbortController().signal);
  const events: StreamEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { result: r.value, events, logs, opts };
    events.push(r.value);
  }
}

/** 计数器：add 累加并继续，stop 结束；预算用完返回当前值 */
function counter(maxSteps: number) {
  let total = 0;
  const spec: AgentSpec<number> = {
    name: "counter",
    messages: [{ role: "system", content: "只输出 JSON" }, { role: "user", content: "开始" }],
    actions: {
      add: {
        parse: (j) => (typeof j.n === "number" && j.n > 0 ? j.n : null),
        async *run(n: number) { total += n; return { observe: `现在是 ${total}` }; },
      },
      stop: {
        parse: () => true,
        async *run() { return { finish: total }; },
      },
    },
    budget: { maxSteps },
    fallback: () => ({ action: "stop" }),
    exhausted: () => total,
    beforeStep: (step) => ({ type: "stage", stage: step === 1 ? "rewrite" : "review" }),
  };
  return spec;
}

test("内核：执行动作、把观察喂回、遇到结束动作返回结果", async () => {
  const { result, events, opts } = await run(counter(5), ['{"action":"add","n":2}', '{"action":"add","n":3}', '{"action":"stop"}']);
  assert.equal(result, 5);
  assert.deepEqual(events.map((e) => e.type === "stage" && e.stage), ["rewrite", "review", "review"]);
  assert.ok(opts.every((o) => o.tier === "fast" && o.json === true));
});

test("内核：输出不合法时走兜底动作，并记日志", async () => {
  const { result, logs } = await run(counter(5), ['{"action":"add","n":4}', "不是 JSON"]);
  assert.equal(result, 4);
  assert.ok(logs.some((l) => l.includes("fallback to stop")));
  // 参数不合法同样走兜底
  assert.equal((await run(counter(5), ['{"action":"add","n":-1}'])).result, 0);
  // 未注册的动作也走兜底
  assert.equal((await run(counter(5), ['{"action":"rm"}'])).result, 0);
});

test("内核：到步数上限就停，返回预算用完时的结果", async () => {
  const { result, logs } = await run(counter(2), ['{"action":"add","n":1}', '{"action":"add","n":1}', '{"action":"add","n":1}']);
  assert.equal(result, 2);
  assert.ok(logs.some((l) => l.includes("budget reached after 2 steps")));
});

test("readJson：只接受对象", () => {
  assert.deepEqual(readJson('好的 {"a":1} 完'), { a: 1 });
  assert.equal(readJson("[1,2]"), null);
  assert.equal(readJson("没有"), null);
});

test("内核：单次决策超时按输出不合法处理，走兜底动作；用户取消照常抛出", async () => {
  // 第二步一直不返回，直到请求被中止
  let calls = 0;
  const llm: LLMProvider = {
    name: "fake", complete: async () => "",
    async *stream(_m, o = {}) {
      if (++calls === 1) { yield { content: '{"action":"add","n":2}' }; return; }
      await new Promise((_, reject) => o.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    },
  };
  const logs: string[] = [];
  const gen = runAgent({ llm, log: (m) => logs.push(m) }, { ...counter(5), decideMs: 30 }, new AbortController().signal);
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  assert.equal(r.value, 2);
  assert.ok(logs.some((l) => l.includes("timed out")) && logs.some((l) => l.includes("fallback to stop")));

  const user = new AbortController();
  calls = 1;
  const pending = runAgent({ llm, log: () => {} }, counter(5), user.signal);
  const step = pending.next().then(() => pending.next());
  setTimeout(() => user.abort(), 10);
  await assert.rejects(step);
});
