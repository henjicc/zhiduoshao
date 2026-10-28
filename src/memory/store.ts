import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// 个人记忆：一段用户能直接看、直接改的文本，原样交给模型（检索规划与写答案）。只存在本机（WebView 的 localStorage），不上传。
// 文本由快速模型在后台按用户的使用信号维护（consolidate.ts），用户手写的内容优先保留。信号：
// - pending：第一次回答的提问、手动生成详解（反映是否偏好深入），攒够了整理一次
// - sites：点开、阅读过的来源网站计数
// - angles：延伸问题各角度出现、被点的次数
// 已探索过的问题不写进记忆：直接从历史地图里找（brief.ts 的 recall）。
// 记录与使用都受总开关 enabled 与单张地图的 offMaps 控制。

/** 等待整理的信号 */
export interface Signal { kind: "ask" | "detail"; q: string; mapId: string; at: number }

export interface MemoryState {
  enabled: boolean;
  /** 不使用记忆的地图：不记录，也不把记忆用在这张地图的回答上 */
  offMaps: string[];
  /** 记忆本身：交给模型的就是这段文本 */
  text: string;
  /** 最近一次整理或用户修改的时间 */
  updatedAt: number;
  sites: Record<string, { count: number; last: number }>;
  angles: Record<string, { shown: number; clicked: number; last: number }>;
  pending: Signal[];
  /** 开着记忆时提问过的地图（最近的在后）：整理时只拿这些地图的标题判断关注是否反复出现，关着记忆时探索的不算 */
  maps: string[];
}

/** 记忆文本的长度上限：每次提问都会带上它 */
export const MEMORY_MAX = 800;

/** 记住最近多少张提问过的地图 */
const MAPS_KEPT = 30;

const initial = (): MemoryState => ({ enabled: true, offMaps: [], text: "", updatedAt: 0, sites: {}, angles: {}, pending: [], maps: [] });

export const useMemory = create<MemoryState>()(
  persist(initial, {
    name: "zds-memory",
    version: 2,
    // 版本 1 是分条的结构化记忆（同一天内的开发版本），改成一段文本后丢掉旧条目，信号计数保留
    migrate: (p, v) => (v < 2 ? { ...initial(), ...(p as Partial<MemoryState>), text: "", updatedAt: 0 } : p) as MemoryState,
    storage: createJSONStorage(() => localStorage),
  }),
);
const get = useMemory.getState;
const set = useMemory.setState;

/** 这张地图现在记不记、用不用记忆 */
export const memoryOn = (mapId: string | null | undefined) => get().enabled && !!mapId && !get().offMaps.includes(mapId);

/** 记录一次提问：同一问题在等待整理的列表里只留一次（重试、补充检索不重复记） */
export function recordAsk(q: string, mapId: string) {
  if (!memoryOn(mapId) || get().pending.some((s) => s.kind === "ask" && s.q === q && s.mapId === mapId)) return;
  set((s) => ({
    pending: [...s.pending, { kind: "ask" as const, q, mapId, at: Date.now() }].slice(-30),
    maps: [...s.maps.filter((m) => m !== mapId), mapId].slice(-MAPS_KEPT),
  }));
}

export function recordDetail(q: string, mapId: string | null | undefined) {
  if (!mapId || !memoryOn(mapId)) return;
  set((s) => ({ pending: [...s.pending, { kind: "detail" as const, q, mapId, at: Date.now() }].slice(-30) }));
}

/** 来源网址的站点：去掉 www. 前缀；解析不了的忽略 */
export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function recordSite(url: string, mapId: string | null | undefined) {
  const site = siteOf(url);
  if (!site || !mapId || !memoryOn(mapId)) return;
  set((s) => ({ sites: { ...s.sites, [site]: { count: (s.sites[site]?.count ?? 0) + 1, last: Date.now() } } }));
}

/** 延伸问题出现一次 / 被点一次；用户自己输入的追问（角度是「追问」）不算 */
export function recordAngle(dir: string | null, mapId: string | null | undefined, clicked: boolean) {
  if (!dir || dir === "追问" || !mapId || !memoryOn(mapId)) return;
  set((s) => {
    const a = s.angles[dir] ?? { shown: 0, clicked: 0, last: 0 };
    return { angles: { ...s.angles, [dir]: clicked ? { ...a, clicked: a.clicked + 1, last: Date.now() } : { ...a, shown: a.shown + 1 } } };
  });
}

/** 常看的网站：至少点开过 2 次，按次数取前几个 */
export function topSites(state = get(), n = 5) {
  return Object.entries(state.sites).filter(([, v]) => v.count >= 2).sort((a, b) => b[1].count - a[1].count).slice(0, n).map(([site, v]) => ({ site, count: v.count }));
}

/** 常点的追问角度：出现过至少 4 次、被点至少 2 次、点击率不低于 30% */
export function topAngles(state = get(), n = 3) {
  return Object.entries(state.angles)
    .filter(([, v]) => v.shown >= 4 && v.clicked >= 2 && v.clicked / v.shown >= 0.3)
    .sort((a, b) => b[1].clicked / b[1].shown - a[1].clicked / a[1].shown)
    .slice(0, n)
    .map(([dir, v]) => ({ dir, rate: v.clicked / v.shown }));
}

export const memoryActions = {
  setEnabled: (enabled: boolean) => set({ enabled }),
  toggleMap: (mapId: string, off: boolean) => set((s) => ({ offMaps: off ? [...new Set([...s.offMaps, mapId])] : s.offMaps.filter((m) => m !== mapId) })),
  setText: (text: string) => set({ text: text.slice(0, MEMORY_MAX), updatedAt: Date.now() }),
};
