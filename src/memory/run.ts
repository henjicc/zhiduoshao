import { completeFast } from "../api/client.ts";
import { CONSOLIDATE_AT, consolidatePrompt, parseMemory } from "./consolidate.ts";
import { recordAsk, recordSite, topAngles, topSites, useMemory } from "./store.ts";

// 记忆的运行时部分：攒够提问后在后台整理，以及监听来源链接的点击。

let running = false;

/** 后台整理一次：拿走当前等待的信号；失败、或整理期间用户改过记忆，就把信号放回去，下次再试 */
export async function consolidate() {
  const state = useMemory.getState();
  const { text, pending, updatedAt } = state;
  if (running || pending.filter((s) => s.kind === "ask").length < CONSOLIDATE_AT) return;
  running = true;
  useMemory.setState({ pending: [] });
  try {
    const raw = await completeFast("memory", consolidatePrompt(text, { pending, sites: topSites(state), angles: topAngles(state) }));
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
