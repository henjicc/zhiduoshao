// 界面与编排层之间的请求与流式事件契约。供应商细节不出现在这里。

/** 延伸问题的角度标签，由模型按问题自拟（2 到 4 字） */
export type Direction = string;

/** 元宝搜索的垂直领域：政务、新闻、学术、财经 */
export type Industry = "gov" | "news" | "acad" | "finance";

/** 改写阶段给出的一条检索：查询词，可选时间范围（如 d7、m1、y1）、垂直领域与限定站点（一个域名） */
export interface SearchPlan {
  q: string;
  freshness?: string;
  industry?: Industry;
  site?: string;
}

/** 一次元宝搜索的记录：查询词与实际发出的参数、返回条数、第几轮，供侧边栏「检索过程」展示 */
export interface SearchLog extends SearchPlan {
  hits: number;
  round: number;
}

/** 检索过程里的一步，侧边栏「检索过程」按顺序画成时间线：一轮搜索（带补搜理由与去重数），或一次读全文 */
export type ResearchStep =
  | { kind: "search"; round: number; reason?: string; results: number; unique: number; ms: number; queries: SearchLog[] }
  | { kind: "read"; titles: string[]; ok: number };

/** 查询的唯一写法：限定站点的写成「查询词 site:域名」，用于去重、「已搜过」与界面显示 */
export const queryKey = (p: SearchPlan) => (p.site ? `${p.q} site:${p.site}` : p.q);

/** 搜索更多来源后，一个节点最多累积的来源数，避免提示词过长 */
export const SOURCES_CAP = 40;

export interface Source {
  /** 去重用的唯一标识：网页为 URL；没有链接的权威卡片为「card:标题」 */
  id: string;
  title: string;
  /** 权威卡片可能没有自己的链接，此时为空字符串 */
  url: string;
  site: string;
  favicon?: string;
  /** ISO 日期或供应商原始日期字符串 */
  date?: string;
  snippet: string;
  /** 元宝的优质权威垂直信源结果（VR 卡） */
  card?: boolean;
  /** 权威卡片的类别（元宝的 vr_category，如 weather） */
  cardType?: string;
  /** 权威度 0–5（元宝旗舰版才有） */
  authority?: number;
  /** 文中配图（元宝标准版及以上） */
  pics?: { url: string; caption: string }[];
  /** 附件子链（元宝旗舰版） */
  links?: { title: string; url: string }[];
  /** 研究 Agent 读取到的网页正文（按需抓取，截到上限）；有它时写答案优先用全文 */
  text?: string;
}

export interface Point {
  text: string;
  /** 指向本节点 sources 的 1 基序号 */
  cites: number[];
}

/**
 * 智能卡片：模型判断内容适合时，把来源里的数据排成表格、时间线或关键数字，卡片上和结论、要点一起显示。
 * 每项都带来源角标（cites 指向本节点 sources 的 1 基序号）。
 */
export type Visual =
  | { kind: "table"; title: string; columns: string[]; rows: { cells: string[]; cites: number[] }[] }
  | { kind: "timeline"; title: string; items: { time: string; text: string; cites: number[] }[] }
  | { kind: "stats"; title: string; items: { label: string; value: string; cites: number[] }[] }
  /** 几项同一指标的数值比较；highlight 为要突出的那一项（其余变灰） */
  | { kind: "bar"; title: string; unit: string; items: { label: string; value: number; cites: number[]; highlight?: boolean }[] }
  /** 一个指标随时间的变化 */
  | { kind: "line"; title: string; unit: string; points: { x: string; y: number; cites: number[] }[] }
  /** 整体的构成（份额、占比） */
  | { kind: "donut"; title: string; unit: string; items: { label: string; value: number; cites: number[] }[] };

export interface Followup {
  dir: Direction;
  q: string;
}

/** 提供给编排层的已有节点上下文 */
export interface NodeContext {
  q: string;
  summary: string;
  points: Point[];
  sources: Source[];
}

/** 用户在输入框旁选的回答偏好；都取默认值时等于不额外要求 */
export interface Prefs {
  /** auto 为默认：由模型按问题决定详略；concise 简洁明了 */
  style: "auto" | "concise" | "plain" | "deep" | "custom";
  /** style 为 custom 时用户自己写的要求 */
  customStyle: string;
  /** official：检索时优先官方网站与权威来源 */
  sources: "auto" | "official";
  /** 只检索最近一段时间的内容（元宝的 Freshness） */
  time: "auto" | "d7" | "m1";
}

/** 个人记忆给这次回答的提示（memory/brief.ts 生成）：检索规划、写答案、生成延伸问题各一段 */
export interface MemoryBrief {
  research?: string;
  answer?: string;
  followup?: string;
}

export interface AnswerRequest {
  question: string;
  /** 从根到父节点的路径，帮助模型理解追问语境 */
  path: { q: string; summary: string }[];
  /** 画布上已有的问题，用于延伸问题去重 */
  existing: string[];
  search: boolean;
  /** 用户附带的图片（data URL） */
  images?: string[];
  /** 之前已识别出的图片文字描述；重试时带上，不再重复识别 */
  imageNote?: string;
  /** 搜索更多来源：已经搜过的查询词与已有来源，本次换角度补充检索后重新整理答案 */
  more?: { queries: string[]; sources: Source[] };
  /** 看看新进展：只检索这一天（yyyy-mm-dd）到今天发布的内容，跳过上一层已有的来源（exclude 为来源 id） */
  since?: string;
  exclude?: string[];
  prefs?: Prefs;
  memory?: MemoryBrief;
}

export type OpKind = "summary" | "relate" | "deepen" | "expand" | "custom";

export interface SynthesizeRequest {
  op: OpKind;
  instruction?: string;
  nodes: NodeContext[];
  existing: string[];
  search: boolean;
  prefs?: Prefs;
}

/** 详情页的详解：在卡片精简回答的基础上展开，复用节点已有的来源 */
export interface DetailRequest {
  question: string;
  path: { q: string; summary: string }[];
  node: NodeContext;
  prefs?: Prefs;
}

/** 延伸列表底部的输入：由轻量模型判断是要回答的问题，还是要更多探索方向 */
export interface CommandRequest {
  input: string;
  node: { q: string; summary: string };
  path: { q: string; summary: string }[];
  /** 这个节点下已有的问题，生成新方向时避开 */
  existing: string[];
}

export interface SummaryRequest {
  scope: "all" | "path" | "selection";
  nodes: NodeContext[];
}

/** see：识别图片；review：检索循环里复查资料够不够；fetch：读取来源网页全文；read：主模型阅读来源 */
export type Stage = "see" | "rewrite" | "search" | "review" | "fetch" | "read" | "compose";

/** 阶段附带的信息：检索词、来源数、研究循环的第几轮 */
export interface StageDetail { queries?: string[]; count?: number; round?: number; titles?: string[] }

export type StreamEvent =
  | { type: "stage"; stage: Stage; detail?: StageDetail }
  /** 输入被判断为问题：界面据此新建追问节点并开始回答 */
  | { type: "ask"; question: string }
  | { type: "title"; text: string }
  | { type: "sources"; sources: Source[] }
  /** 一轮元宝搜索完成：服务返回的结果条数（多个查询合计，去重前）、其中不重复的新结果数（去掉本轮内重复和已有来源），
   * 以及补充检索的理由（研究助手判断还缺什么；第一轮没有） */
  | { type: "searched"; results: number; plans: SearchLog[]; ms: number; unique: number; reason?: string }
  /** 研究助手读了几篇来源的全文：标题与读成功的篇数 */
  | { type: "read"; titles: string[]; ok: number }
  | { type: "summary"; delta: string }
  | { type: "point"; point: Point }
  | { type: "visual"; visual: Visual }
  | { type: "followup"; followup: Followup }
  /** 总结文档的增量文本 */
  | { type: "text"; delta: string }
  /** 模型思考过程的增量文本，只用于等待时的动态反馈 */
  | { type: "thinking"; delta: string }
  /** 图片识别完成后的完整文字描述，界面存到节点上供重试复用 */
  | { type: "vision"; text: string }
  | { type: "done" }
  /** code 为 auth / config 时界面提供前往设置的入口 */
  | { type: "error"; stage?: Stage; message: string; code?: ErrorCode; hint?: string };

export type ErrorCode = "auth" | "config" | "quota" | "network" | "other";
