import type { GNode } from "../store/types.ts";

// 一张知识地图的存档格式与转换。纯函数，便于测试；读写数据库见 db.ts。

export interface SavedView { x: number; y: number; s: number }

export interface MapMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 已回答的节点数 */
  answers: number;
  /** 所有节点的问题，供历史搜索 */
  text: string;
}

export interface MapRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  nodes: Record<string, GNode>;
  view: SavedView;
  /** 根节点锚点的含义：top 为左上角；早期存档没有这个字段，锚点是中心纵坐标 */
  anchor?: "top";
  /** 激活过的节点：设置为「保持展开」时它们的要点一直显示，重新打开地图后保持原样；早期存档没有 */
  opened?: string[];
}

/** 早期存档的锚点是根节点中心，换成顶边时按默认卡片高度的一半估算 */
const LEGACY_HALF_H = 70;

export const INTERRUPTED = "上次没有完成，已中断";

/** 起始问题：第一个既无父节点、也不是综合结果的节点 */
export function rootOf(nodes: Record<string, GNode>) {
  return Object.values(nodes).find((n) => !n.parent && !n.links.length);
}

/** 至少有一个回答完成才值得存档；一开始就失败（如未填密钥）的地图不进历史 */
export const worthSaving = (nodes: Record<string, GNode>) =>
  Object.values(nodes).some((n) => n.kind === "answer" && n.status === "ready");

/** 去掉只在等待时有用的字段 */
export function toRecord(id: string, createdAt: number, updatedAt: number, nodes: Record<string, GNode>, view: SavedView, opened: Record<string, true> = {}): MapRecord {
  const clean: Record<string, GNode> = {};
  for (const [k, n] of Object.entries(nodes)) clean[k] = { ...n, thinking: "", stage: null, stageDetail: null };
  return { id, createdAt, updatedAt, nodes: clean, view: { x: view.x, y: view.y, s: view.s }, anchor: "top", opened: Object.keys(opened).filter((k) => nodes[k]) };
}

export function metaOf(r: MapRecord): MapMeta {
  const all = Object.values(r.nodes);
  return {
    id: r.id,
    title: rootOf(r.nodes)?.q ?? "未命名",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    answers: all.filter((n) => n.kind === "answer" && n.status === "ready").length,
    text: all.map((n) => n.q).join("\n"),
  };
}

/** 打开存档：保存时还在进行中的节点无法续上，标记为中断，卡片上提供重试 */
export function restoreNodes(nodes: Record<string, GNode>, legacyAnchor = false): Record<string, GNode> {
  const out: Record<string, GNode> = {};
  for (const [k, n] of Object.entries(nodes)) {
    const pending = n.status === "loading" || n.status === "streaming";
    // 早期存档没有图片、查询词、智能卡片与详解字段；未写完的详解下次打开时重新生成
    const base = {
      ...n, images: n.images ?? [], imageNote: n.imageNote ?? "", queries: n.queries ?? [], searchResults: n.searchResults ?? 0, errorHint: n.errorHint ?? null, answeredAt: n.answeredAt ?? 0, since: n.since ?? null, visual: n.visual ?? null, memory: n.memory ?? null, searches: n.searches ?? [], steps: n.steps ?? [], dropped: n.dropped ?? [], searchMs: n.searchMs ?? 0, searchMode: n.searchMode ?? null, compareOf: n.compareOf ?? null, nextWhy: n.nextWhy ?? null, framed: n.framed ?? false, settled: n.settled ?? false,
      ...(n.detailStatus === "ready" ? { detail: n.detail, detailStatus: "ready" as const } : { detail: "", detailStatus: "idle" as const }),
      ...(legacyAnchor && !n.parent ? { ay: n.ay - LEGACY_HALF_H } : {}),
    };
    out[k] = pending ? { ...base, status: "error", error: INTERRUPTED, errorCode: null, errorHint: null } : base;
  }
  return out;
}

/** 节点 id 形如 n12；恢复后新节点从最大编号之后继续 */
export function maxSeq(nodes: Record<string, GNode>) {
  return Object.keys(nodes).reduce((m, id) => Math.max(m, Number(id.slice(1)) || 0), 0);
}

export type Group = "今天" | "昨天" | "近 7 天" | "更早";

export function groupOf(t: number, now = Date.now()): Group {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  if (t >= start) return "今天";
  if (t >= start - 86400000) return "昨天";
  if (t >= start - 6 * 86400000) return "近 7 天";
  return "更早";
}

/** 历史记录里的时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / M 月 D 日 */
export function ago(t: number, now = Date.now()) {
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  if (groupOf(t, now) === "今天") return `${Math.floor(min / 60)} 小时前`;
  if (groupOf(t, now) === "昨天") return "昨天";
  const d = new Date(t), y = new Date(now).getFullYear();
  return `${d.getFullYear() === y ? "" : d.getFullYear() + " 年 "}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function matches(m: MapMeta, query: string) {
  const q = query.trim().toLowerCase();
  return !q || m.title.toLowerCase().includes(q) || m.text.toLowerCase().includes(q);
}
