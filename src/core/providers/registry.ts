import { profiles } from "../models.ts";
import { createMockLLM, createMockReader, createMockSearch } from "./mock.ts";
import { createTokenHub, isPlanKey } from "./tokenhub.ts";
import { ProviderError, type HttpFetch, type LLMProvider, type SearchProvider } from "./types.ts";
import { createPageReader, type PageReader } from "./web.ts";
import { createYuanbao } from "./yuanbao.ts";

// 供应商注册表：根据设置创建本次请求使用的大模型与搜索。
// 当前只接入腾讯：TokenHub（主模型 + 轻量模型，见 models.ts）+ 元宝搜索。新增供应商时在这里增加分支。

export interface ProviderSettings {
  searchKey: string;
  llmKey: string;
  model: string;
  mock: boolean;
  fetch: HttpFetch;
  /** 读网页全文用的请求：不经调试日志的完整记录（网页 HTML 太大），由研究 Agent 自己记摘要 */
  pageFetch: HttpFetch;
}

export function createProviders(s: ProviderSettings): { llm: LLMProvider; search: SearchProvider | null; reader: PageReader } {
  if (s.mock) return { llm: createMockLLM(), search: createMockSearch(), reader: createMockReader() };
  const llmKey = s.llmKey.trim();
  if (!llmKey) throw new ProviderError("tokenhub", "尚未填写 TokenHub API Key", undefined, "config");
  if (isPlanKey(llmKey)) throw new ProviderError("tokenhub", "套餐密钥不能用于本应用，请改用 TokenHub 按量 API Key", undefined, "config");
  const searchKey = s.searchKey.trim();
  return {
    llm: createTokenHub({ apiKey: llmKey, models: profiles(s.model), fetch: s.fetch }),
    search: searchKey ? createYuanbao({ apiKey: searchKey, fetch: s.fetch }) : null,
    reader: createPageReader(s.pageFetch),
  };
}
