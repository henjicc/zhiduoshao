import type { ModelTier } from "../models.ts";
import type { ErrorCode, Industry, Source } from "../protocol.ts";

/** OpenAI 兼容的多模态内容块：图片用 data URL（base64）传入 */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** 取出消息里的文字部分 */
export const textOf = (c: ChatMessage["content"]) =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");

export interface ChatOptions {
  /** 选用哪档模型，见 models.ts；默认 main */
  tier?: ModelTier;
  /** 覆盖该档模型的思考开关（例如连接测试一律关闭） */
  thinking?: boolean;
  /** 要求输出合法 JSON（OpenAI 兼容的 response_format: json_object），用于结构化决策 */
  json?: boolean;
  /** 限制输出长度 */
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** 流式增量：content 是正式输出；reasoning 是模型的思考过程（有思维链的模型才有） */
export interface ChatDelta {
  content?: string;
  reasoning?: string;
}

/** 大模型供应商：只暴露编排层需要的两种调用 */
export interface LLMProvider {
  readonly name: string;
  complete(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<ChatDelta>;
}

export interface SearchOptions {
  count?: number;
  /** 时间范围，格式同元宝搜索 Freshness */
  freshness?: string;
  industry?: Industry;
  /** 只搜这个域名（元宝 Site 参数，只对自然结果生效） */
  site?: string;
  signal?: AbortSignal;
}

/** 搜索供应商：返回统一的 Source 结构 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<Source[]>;
}

/** 服务返回的可核对信息：hint 是给用户的原因与处理办法，code / requestId 用于向腾讯云核对 */
export interface ProviderErrorInfo {
  hint?: string;
  code?: string;
  requestId?: string;
}

/** 供应商边界的统一错误：message 是一句话结论；info 给出具体原因；detail 是原始响应，只进日志；
 * kind 为 auth（密钥无效或无权限）、config（尚未配置）、quota（频率或额度受限）等 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly detail?: string,
    readonly kind: ErrorCode = "other",
    readonly info: ProviderErrorInfo = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** 发出 HTTP 请求的实现：桌面应用里走 Tauri HTTP 插件，浏览器开发时用原生 fetch */
export type HttpFetch = (input: string, init: RequestInit) => Promise<Response>;
