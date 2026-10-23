// 任务 → 模型的唯一配置入口。
// main：用户在设置里选的主模型，负责需要质量的生成（整理答案、综合节点、总结），保留思考。
// fast：固定的轻量模型，负责简单的结构化步骤（改写搜索词），关闭思考以缩短等待。
// vision：图片理解模型。混元语言模型（hy4-preview、hy3）不支持图片输入，用户附图时先由它把图片转成文字描述，
// 再交给主模型回答。
// 换模型只改这里；模型须在 TokenHub 可用（同一个 API Key、同一个接口）。

export type ModelTier = "main" | "fast" | "vision";

export interface ModelProfile {
  model: string;
  /** false 时请求带 thinking: { type: "disabled" }；null 表示模型没有思考开关，请求里不带这个字段 */
  thinking: boolean | null;
  label: string;
}

/** 主模型候选：显示在设置页 */
export const MAIN_MODELS = [
  { id: "hy4-preview", label: "Hy4 Preview" },
  { id: "hy3", label: "Hy3" },
] as const;
export type MainModel = (typeof MAIN_MODELS)[number]["id"];
export const DEFAULT_MAIN_MODEL: MainModel = "hy4-preview";

/** 轻量模型：DeepSeek Flash，支持关闭思考。文档：https://cloud.tencent.com/document/product/1823/132248
 * 模型 ID 以账号控制台「在线推理服务」列表为准：文档列出的 deepseek-v4-flash 在实际账号下返回 400004（不存在），
 * 可用的是 deepseek/deepseek-flash。 */
export const FAST_MODEL: ModelProfile = { model: "deepseek/deepseek-flash", thinking: false, label: "DeepSeek Flash" };

/** 图片理解：腾讯混元视觉模型，文档示例模型。文档：https://cloud.tencent.com/document/product/1823/136956
 * 同平台的 deepseek/deepseek-v4-flash-vision-exp 是实验版，未选用。 */
export const VISION_MODEL: ModelProfile = { model: "hy-vision-2.0-instruct", thinking: null, label: "HY Vision 2.0" };

export function profiles(mainModel: string): Record<ModelTier, ModelProfile> {
  const label = MAIN_MODELS.find((m) => m.id === mainModel)?.label ?? mainModel;
  return { main: { model: mainModel, thinking: true, label }, fast: FAST_MODEL, vision: VISION_MODEL };
}
