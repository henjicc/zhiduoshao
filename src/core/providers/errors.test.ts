import assert from "node:assert/strict";
import { test } from "node:test";
import { llmError } from "./tokenhub.ts";
import { searchError } from "./yuanbao.ts";

test("元宝搜索：UnauthorizedOperation 归为密钥问题，并带出错误码与 RequestId", () => {
  const raw = '{"Response":{"Error":{"Code":"UnauthorizedOperation","Message":"未授权操作。"},"RequestId":"rid-1"}}';
  const e = searchError(200, { Code: "UnauthorizedOperation", Message: "未授权操作。" }, "rid-1", raw);
  assert.equal(e.kind, "auth");
  assert.equal(e.info.code, "UnauthorizedOperation");
  assert.equal(e.info.requestId, "rid-1");
  assert.match(e.info.hint ?? "", /完整明文密钥/);
});

test("元宝搜索：开通、欠费、限流各自给出对应原因；未知错误透出服务原文", () => {
  assert.match(searchError(200, { Code: "ResourceNotFound", Message: "" }, undefined, "").info.hint ?? "", /开通服务/);
  assert.match(searchError(200, { Code: "ResourceUnavailable", Message: "" }, undefined, "").info.hint ?? "", /欠费/);
  assert.equal(searchError(200, { Code: "RequestLimitExceeded", Message: "" }, undefined, "").kind, "quota");
  const other = searchError(200, { Code: "InvalidParameter", Message: "Cnt 不合法" }, undefined, "");
  assert.equal(other.info.hint, "服务返回：Cnt 不合法");
});

test("混元：401 使用服务返回的中文说明与 request_id", () => {
  const raw = JSON.stringify({ error: { code: "401002", message: "x", message_zh: "API Key 不存在或签名校验失败", request_id: "rid-2" } });
  const e = llmError(401, raw);
  assert.equal(e.kind, "auth");
  assert.equal(e.info.code, "401002");
  assert.equal(e.info.requestId, "rid-2");
  assert.match(e.info.hint ?? "", /^API Key 不存在或签名校验失败。/);
});

test("混元：非 JSON 错误体只依据状态码", () => {
  const e = llmError(502, "<html>bad gateway</html>");
  assert.equal(e.kind, "other");
  assert.equal(e.info.code, "HTTP 502");
});

test("混元：模型不存在等 4xx 用服务说明的第一句作为结论", () => {
  const raw = JSON.stringify({ error: { code: "400004", message_zh: "请求中的模型或服务 ID x 不存在，请检查服务 ID 是否正确。", request_id: "rid-3" } });
  const e = llmError(400, raw);
  assert.equal(e.message, "请求中的模型或服务 ID x 不存在");
  assert.equal(e.info.code, "400004");
});

test("混元：402 归为余额不足、429 归为频繁，并给出处理办法", () => {
  const poor = llmError(402, '{"error":{"code":"402001","message_zh":"账户余额不足"}}');
  assert.equal(poor.message, "TokenHub 账户余额不足");
  assert.match(poor.info.hint ?? "", /^账户余额不足。请到腾讯云控制台充值/);
  assert.equal(llmError(429, "").message, "大模型请求过于频繁");
});
