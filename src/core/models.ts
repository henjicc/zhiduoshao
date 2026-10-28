// 任务 → 模型的唯一配置入口。
// main：用户在设置里选的主模型，负责需要质量的生成（整理答案、综合节点、总结），保留思考。
// fast：轻量模型，负责简单的结构化步骤（改写搜索词、研究循环的决策、输入框路由），思考用 low 以缩短等待。
// vision：图片理解。主模型能直接读图时（images 为 true）不单独看图，图片直接交给研究与回答；
// 不能读图的主模型（混元语言模型）由视觉模型先把图片转成文字描述，再交给主模型回答。
// 目前主模型与轻量模型都用 DeepSeek Flash（用户 2026-10 要求统一，方便对比不同模型的效果）；两档仍分开配置，换模型只改这里。
// 模型须在 TokenHub 可用（同一个 API Key、同一个接口）。

export type ModelTier = "main" | "fast" | "vision";

/**
 * 思考深度：off 关闭思考（thinking: { type: "disabled" }），其余作为 reasoning_effort 发出。
 * DeepSeek Flash 支持 low / high（默认）/ max 三档（TokenHub 文档 https://cloud.tencent.com/document/product/1823/132248）。
 * 分配（用户 2026-10 要求：影响质量的环节加大、最高 max；其他环节调低但尽量不关）：
 * 写答案、综合、详解、总结用主模型的 max；规划检索、研究循环决策、输入框路由、记忆整理和简单事实的快速回答用 low；
 * 只有设置页的连接测试（只要回复 OK、限 4 个 token）关闭
 */
export type Effort = "off" | "low" | "high" | "max";

export interface ModelProfile {
  model: string;
  /** 这一档默认的思考深度；null 表示模型没有思考开关，请求里不带思考字段 */
  thinking: Effort | null;
  label: string;
  /** 能直接读图（请求里放 image_url） */
  images: boolean;
}

/** DeepSeek Flash：支持关闭思考，也能直接读图（2026-10 用真实 Key 实测：认出图中文字，开思考时返回思维链）。
 * 文档：https://cloud.tencent.com/document/product/1823/132248
 * 模型 ID 以账号控制台「在线推理服务」列表为准：文档列出的 deepseek-v4-flash 在实际账号下返回 400004（不存在），
 * 可用的是 deepseek/deepseek-flash。 */
const DEEPSEEK_FLASH = "deepseek/deepseek-flash";

/** 主模型候选。hidden 的仍可用（老设置迁移、换回测试），只是不显示在设置页；设置页只剩一个可选时不显示选择 */
export const MAIN_MODELS = [
  { id: DEEPSEEK_FLASH, label: "DeepSeek Flash", images: true, hidden: false, effort: "max" },
  // 混元带 reasoning_effort: low 是原来实测过的设置，保持不变
  { id: "hy4-preview", label: "Hy4 Preview", images: false, hidden: true, effort: "low" },
  { id: "hy3", label: "Hy3", images: false, hidden: true, effort: "low" },
] as const;
export type MainModel = (typeof MAIN_MODELS)[number]["id"];
export const DEFAULT_MAIN_MODEL: MainModel = DEEPSEEK_FLASH;
/** 设置页可选的主模型 */
export const VISIBLE_MODELS = MAIN_MODELS.filter((m) => !m.hidden);

export const FAST_MODEL: ModelProfile = { model: DEEPSEEK_FLASH, thinking: "low", label: "DeepSeek Flash", images: true };

/** 图片理解：腾讯混元视觉模型，只在主模型不能读图时使用。文档：https://cloud.tencent.com/document/product/1823/136956 */
export const VISION_MODEL: ModelProfile = { model: "hy-vision-2.0-instruct", thinking: null, label: "HY Vision 2.0", images: true };

export function profiles(mainModel: string): Record<ModelTier, ModelProfile> {
  const m = MAIN_MODELS.find((x) => x.id === mainModel);
  const main: ModelProfile = { model: mainModel, thinking: m?.effort ?? "low", label: m?.label ?? mainModel, images: m?.images ?? false };
  return { main, fast: FAST_MODEL, vision: main.images ? main : VISION_MODEL };
}

/** 研究与回答能不能直接看图：规划检索的轻量模型和写答案的主模型都要能读图，否则先由视觉模型转成文字 */
export const seesImages = (p: Record<ModelTier, ModelProfile>) => p.main.images && p.fast.images;
