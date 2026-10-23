import type { ModelProfile, ModelTier } from "../models.ts";
import { ProviderError, type ChatMessage, type ChatOptions, type HttpFetch, type LLMProvider } from "./types.ts";

// 腾讯云 TokenHub：按量 API Key，OpenAI Chat Completions 兼容协议；同一个 Key 可调用混元、DeepSeek 等模型
// 文档：https://cloud.tencent.com/document/product/1823/132252
// Coding Plan（sk-sp-）与 Token Plan（sk-tp-）套餐密钥按条款不得用于应用后端，见 isPlanKey。
export const TOKENHUB_BASE_URL = "https://tokenhub.tencentmaas.com/v1";

/** 订阅套餐的专属密钥，套餐条款禁止用于自定义应用 */
export const isPlanKey = (key: string) => /^sk-(sp|tp)-/i.test(key.trim());

export interface TokenHubConfig {
  apiKey: string;
  /** 各档模型，见 models.ts 的 profiles() */
  models: Record<ModelTier, ModelProfile>;
  fetch: HttpFetch;
}

export function createTokenHub(cfg: TokenHubConfig): LLMProvider {
  const name = "tokenhub";
  const url = `${TOKENHUB_BASE_URL}/chat/completions`;

  async function request(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    const p = cfg.models[opts.tier ?? "main"];
    const thinking = p.thinking === null ? null : opts.thinking ?? p.thinking;
    let res: Response;
    try {
      res = await cfg.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: p.model,
          messages,
          stream,
          temperature: opts.temperature ?? 0.4,
          // 开启思考时用文档给出的较低推理深度，缩短首字等待；关闭思考用于简单的结构化步骤；
          // 没有思考开关的模型（视觉模型）不带这两个字段
          ...(thinking === null ? {} : thinking ? { reasoning_effort: "low" } : { thinking: { type: "disabled" } }),
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          // JSON 模式：保证输出合法 JSON（提示词里必须写明要输出 JSON，否则可能一直输出空内容）
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      throw new ProviderError(name, "无法连接 TokenHub 大模型服务", String(err), "network", { hint: "请求没能送达TokenHub（tokenhub.tencentmaas.com），服务没有收到。常见原因是网络断开、代理或 VPN 拦截了连接、连接超时；检查网络后点重试。" });
    }
    if (!res.ok) throw llmError(res.status, await res.text().catch(() => ""));
    return res;
  }

  async function complete(messages: ChatMessage[], opts: ChatOptions = {}) {
    const res = await request(messages, opts, false);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new ProviderError(name, "大模型返回内容为空", JSON.stringify(json).slice(0, 500));
    return text;
  }

  return {
    name,
    complete,
    async *stream(messages, opts = {}) {
      const res = await request(messages, opts, true);
      if (!res.body) throw new ProviderError(name, "大模型未返回数据流");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          let chunk: { choices?: { delta?: { content?: string; reasoning_content?: string } }[] };
          try {
            chunk = JSON.parse(data);
          } catch {
            throw new ProviderError(name, "大模型返回了无法解析的数据", data.slice(0, 200));
          }
          const d = chunk.choices?.[0]?.delta;
          if (d?.reasoning_content) yield { reasoning: d.reasoning_content };
          if (d?.content) yield { content: d.content };
        }
      }
    },
  };
}

/** TokenHub 错误体：{ error: { code, message, message_zh, request_id } } */
export function llmError(status: number, raw: string) {
  let e: { code?: string; message?: string; message_zh?: string; request_id?: string } = {};
  try { e = JSON.parse(raw).error ?? {}; } catch { /* 非 JSON 时只用状态码 */ }
  const auth = status === 401 || status === 403;
  const quota = status === 429 || status === 402;
  const said = e.message_zh || e.message;
  // 服务给的中文说明取第一句作为结论，比只报状态码有用
  const reason = said?.split(/[。，,]/)[0]?.trim();
  const msg = auth ? "TokenHub 不认这个 API Key" : status === 402 ? "TokenHub 账户余额不足" : status === 429 ? "大模型请求过于频繁" : reason || `大模型服务返回错误（${status}）`;
  const hint = auth
    ? `${said ? said + "。" : ""}请使用 TokenHub 控制台创建的按量 API Key。`
    : status === 402 ? `${said ? said + "。" : ""}请到腾讯云控制台充值或购买资源包后重试。`
    : status === 429 ? `${said ? said + "。" : ""}请稍等片刻再试；如果一直出现，可能是余额或额度已用完。`
    : said ?? `服务返回 HTTP ${status}`;
  return new ProviderError("tokenhub", msg, raw.slice(0, 500), auth ? "auth" : quota ? "quota" : "other",
    { hint, code: e.code ?? `HTTP ${status}`, requestId: e.request_id });
}

/** 设置页的连接测试：只验证密钥与模型是否可用。
 * 极简提示 + 关闭思考 + 限制输出，三档模型并行请求；耗时主要是网关往返（实测每个约 3–4 秒）。
 * 失败时指明是哪个模型，按主模型、轻量模型、视觉模型的顺序报告。 */
export async function testTokenHub(cfg: TokenHubConfig) {
  const p = createTokenHub(cfg);
  const tiers = ["main", "fast", "vision"] as const;
  const results = await Promise.allSettled(
    tiers.map((tier) => p.complete([{ role: "user", content: "回复 OK" }], { tier, thinking: false, maxTokens: 4, temperature: 0 })),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    const err = r.reason;
    if (!(err instanceof ProviderError)) throw err;
    const m = cfg.models[tiers[i]];
    throw new ProviderError(err.provider, `${m.label}（${m.model}）：${err.message}`, err.detail, err.kind, err.info);
  });
}
