import type { Direction, ErrorCode, OpKind, Point, ResearchStep, SearchLog, Source, Stage, StageDetail, Visual } from "../core/protocol.ts";

export type NodeStatus = "idle" | "loading" | "streaming" | "ready" | "error";

/** 这次回答用到的个人记忆，卡片上标出来（为什么这样查、关联了哪张地图） */
export interface MemoryNote {
  /** 记忆里写到、检索时真的限定过的站点 */
  sites: string[];
  /** 之前探索过的相关问题，点一下打开那张地图 */
  recalls: { mapId: string; title: string; q: string }[];
}

export interface GNode {
  id: string;
  /** question：只有标题、尚未检索的延伸问题；answer：已提问的节点 */
  kind: "answer" | "question";
  dir: Direction | null;
  /** 延伸问题：回答推荐先问这一条时的理由（半句话），其余为 null */
  nextWhy: string | null;
  q: string;
  parent: string | null;
  /** 综合节点由哪些节点生成 */
  links: string[];
  op: OpKind | null;
  /** 自定义指令（op 为 custom 时） */
  instruction: string | null;
  children: string[];
  collapsed: boolean;
  /** 回答写了「追问：无」：这条线问透了，没有子节点时连线末端画收尾记号；重新回答时清空 */
  settled: boolean;
  status: NodeStatus;
  stage: Stage | null;
  stageDetail: StageDetail | null;
  /** 用户附带的图片（压缩后的 data URL），只有提问时附图的节点才有 */
  images: string[];
  /** 视觉模型对图片的文字描述；重试时复用，不重复识别 */
  imageNote: string;
  summary: string;
  /** 起点是念头、情绪或处境，回答把它拆成了对方其实在决定的几件事（卡片标签「拆开来看」）；重新回答时清空 */
  framed: boolean;
  /** 当前阶段模型的思考过程，只用于等待动画；换阶段时清空 */
  thinking: string;
  points: Point[];
  /** 智能卡片（表格、时间线、关键数字），模型判断内容适合时才有 */
  visual: Visual | null;
  /** 这次回答用到的个人记忆；没用到或关闭了记忆时为 null */
  memory: MemoryNote | null;
  sources: Source[];
  /** 详情抽屉里的详解（Markdown，按需生成并随存档保存） */
  detail: string;
  detailStatus: "idle" | "loading" | "streaming" | "ready" | "error";
  /** 本节点检索用过的查询词（含补充检索），供「搜索更多来源」避开重复 */
  queries: string[];
  /** 对比用的回答：固定联网 / 不联网（不跟随顶栏的联网开关），null 为跟随开关 */
  searchMode: "on" | "off" | null;
  /** 「换个方式再答一次」生成的对比节点：原节点 id，画布上用虚线连过去 */
  compareOf: string | null;
  /** 每次元宝搜索的查询词、参数与返回条数（含补充检索），侧边栏「检索过程」展示；早期存档没有 */
  searches: SearchLog[];
  /** 检索过程的每一步（每轮搜索带补搜理由与去重数，以及读全文），侧边栏「检索过程」画成时间线；
   * 2026-10 之前的存档没有，按 searches 只画查询部分 */
  steps: ResearchStep[];
  /** 元宝搜索累计耗时（毫秒，多个查询并行发出，按每轮计） */
  searchMs: number;
  /** 元宝搜索累计返回的结果条数（去重前，含补充检索）；没联网检索过时为 0 */
  searchResults: number;
  /** 最近一次回答完成的时间（毫秒）；早期存档与未回答的节点为 0 */
  answeredAt: number;
  /** 「看看新进展」节点：只检索这一天（yyyy-mm-dd）以来的内容；重试时沿用 */
  since: string | null;
  error: string | null;
  /** auth / config 时卡片提供前往设置的入口 */
  errorCode: ErrorCode | null;
  /** 出错的原因与处理办法（服务返回的说明或网络问题的排查提示），显示在卡片的错误下方 */
  errorHint: string | null;
  /** 拖动偏移（作用于整个子树） */
  dx: number;
  dy: number;
  /** 根节点锚点（左上角；早期存档的 ay 是中心纵坐标，打开时转换，见 history/snapshot.ts） */
  ax: number;
  ay: number;
}
