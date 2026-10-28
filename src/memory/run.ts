import { completeFast } from "../api/client.ts";
import { listMeta } from "../history/db.ts";
import { CONSOLIDATE_AT, consolidatePrompt, parseMemory } from "./consolidate.ts";
import { recordAsk, recordSite, topAngles, topSites, useMemory } from "./store.ts";

// 记忆的运行时部分：攒够提问后在后台整理，以及监听来源链接的点击。

/** 整理时带上最近几张地图的标题：一批提问只有几次，跨批次反复出现的关注要靠它看出来 */
const RECENT_MAPS = 12;

let running = false;

/** 后台整理一次：拿走当前等待的信号；失败、或整理期间用户改过记忆，就把信号放回去，下次再试 */
export async function consolidate() {
  const state = useMemory.getState();
  const { text, pending, updatedAt } = state;
  if (running || pending.filter((s) => s.kind === "ask").length < CONSOLIDATE_AT) return;
  running = true;
  useMemory.setState({ pending: [] });
  try {
    // 读不到历史时照样整理，只是少了跨地图的判断依据
    const metas = await listMeta().catch((e) => { console.error("[memory] 读取历史地图失败", e); return []; });
    // 近期提问所在的地图都要有标题（分组用），不占「其他地图」的名额
    const asked = new Set(pending.map((s) => s.mapId));
    const usable = metas.filter((m) => !state.offMaps.includes(m.id));
    const maps = [...usable.filter((m) => asked.has(m.id)), ...usable.filter((m) => !asked.has(m.id) && state.maps.includes(m.id)).slice(0, RECENT_MAPS)]
      .map(({ id, title }) => ({ id, title }));
    const raw = await completeFast("memory", consolidatePrompt(text, { pending, sites: topSites(state), angles: topAngles(state), maps }));
    const next = raw ? parseMemory(raw) : null;
    if (!next || useMemory.getState().updatedAt !== updatedAt) {
      useMemory.setState((s) => ({ pending: [...pending, ...s.pending].slice(-30) }));
      return;
    }
    useMemory.setState({ text: next, updatedAt: Date.now() });
  } finally {
    running = false;
  }
}

/** 记一次提问，攒够了就整理 */
export function noteAsk(q: string, mapId: string) {
  recordAsk(q, mapId);
  void consolidate();
}

let listening = false;

/** 点开来源原网页（来源列表、引用气泡里的链接）记为「看过这个网站」；侧边栏阅读在 actions.readSource 里记 */
export function startMemory(currentMap: () => string | null) {
  if (listening) return;
  listening = true;
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>(".source[href], .cite-pop-act[href], .source-links a[href]");
    const map = currentMap();
    if (a && map) recordSite(a.href, map);
  }, true);
}
