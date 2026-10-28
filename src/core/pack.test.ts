import assert from "node:assert/strict";
import test from "node:test";
import { packBody, parsePackMode, requestKey, safeHeaders, schedule, scrubSecrets, secretsOf, type PackCall } from "./pack.ts";

test("换一天重放也对得上：比较请求时去掉日期，其余内容不同就对不上", () => {
  const body = (day: string, q: string) => packBody(JSON.stringify({ model: "m", messages: [{ role: "system", content: `时效：今天是 ${day}` }, { role: "user", content: q }] }));
  const url = "https://tokenhub.tencentmaas.com/v1/chat/completions";
  assert.equal(requestKey("POST", url, body("2026-10-29", "问")), requestKey("post", url, body("2026-11-03", "问")));
  assert.notEqual(requestKey("POST", url, body("2026-10-29", "问")), requestKey("POST", url, body("2026-10-29", "另一个问题")));
  assert.notEqual(requestKey("GET", "https://a.com/1", undefined), requestKey("GET", "https://a.com/2", undefined));
});

test("数据包里不留密钥：请求头、请求体里的密钥字段去掉，见过的密钥值在整份文本里替换", () => {
  const headers = { Authorization: "Bearer sk-abcdefghijklmnop", "Content-Type": "application/json" };
  assert.deepEqual(safeHeaders(headers), { "content-type": "application/json" });
  assert.deepEqual(packBody(JSON.stringify({ api_key: "x", nested: { token: "y", max_tokens: 4 }, q: "问" })), { nested: { max_tokens: 4 }, q: "问" });
  const secrets = secretsOf(headers);
  assert.deepEqual(secrets, ["sk-abcdefghijklmnop"]);
  assert.equal(scrubSecrets('{"echo":"sk-abcdefghijklmnop"}', secrets), '{"echo":"***"}');
});

const sse = (delta: Record<string, string>) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const streamCall = (body: object): PackCall => ({
  at: 0, method: "POST", url: "u", headers: {}, body,
  response: {
    status: 200, headers: { "content-type": "text/event-stream" }, firstByteMs: 500, encoding: "utf8",
    chunks: [[1000, sse({ reasoning_content: "想一想" })], [3000, sse({ content: "结论：好" }) + sse({ content: "的" })], [3100, "data: [DONE]\n\n"]],
  },
});

test("重放节奏：默认照录制时间按 speed 缩放；写答案的正文流可按每秒字数重排，研究决策不改", () => {
  const answer = streamCall({ stream: true });
  assert.deepEqual(schedule(answer, { speed: 2 }).chunks.map(([t]) => t), [500, 1500, 1550]);
  // 正文 4 字 + 1 字按每秒 10 字排；思考没设 thinkCps，照录制（首包后 500ms）
  const paced = schedule(answer, { speed: 1, cps: 10, firstMs: 200 });
  assert.equal(paced.headersAt, 200);
  assert.deepEqual(paced.chunks.map(([t]) => Math.round(t)), [700, 1100, 1200, 1300]);
  assert.equal(paced.chunks.map(([, c]) => c).join(""), answer.response!.chunks.map(([, c]) => c).join(""));
  // 研究决策不按字数重排，也不随 speed 变快变慢（会碰到或躲开 12 秒时限、45 秒预算，走上别的路）
  const decision = streamCall({ stream: true, response_format: { type: "json_object" } });
  assert.deepEqual(schedule(decision, { speed: 1, cps: 10 }).chunks.map(([t]) => t), [1000, 3000, 3100]);
  assert.deepEqual(schedule(decision, { speed: 0.5 }).chunks.map(([t]) => t), [1000, 3000, 3100]);
  assert.deepEqual(schedule(decision, { speed: 3 }).chunks.map(([t]) => t), [1000, 3000, 3100]);
  assert.deepEqual(schedule(answer, { speed: 0.5 }).chunks.map(([t]) => t), [2000, 6000, 6200]);
});

test("地址参数选模式：数据包名不能带路径，采集与重放不能同时开", () => {
  assert.equal(parsePackMode(""), null);
  assert.deepEqual(parsePackMode("?capture=演示"), { kind: "capture", name: "演示" });
  assert.deepEqual(parsePackMode("?replay=a&speed=1.5&cps=40&firstMs=0"), { kind: "replay", name: "a", pace: { speed: 1.5, cps: 40, thinkCps: undefined, firstMs: 0 } });
  assert.throws(() => parsePackMode("?replay=../x"));
  assert.throws(() => parsePackMode("?replay=a&capture=b"));
});
