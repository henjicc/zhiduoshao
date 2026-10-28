import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_MAIN_MODEL, VISIBLE_MODELS, type MainModel } from "../core/models.ts";
import type { Prefs } from "../core/protocol.ts";

// 用户的 API Key 只保存在本机：桌面应用里是应用自己的数据目录，不上传到任何地方。

export interface Settings {
  searchKey: string;
  llmKey: string;
  /** 主模型；轻量模型固定在 models.ts */
  model: MainModel;
  /** 切换节点时是否收起上一个节点的要点 */
  autoCollapse: boolean;
  /** 打开详情侧边栏时自动生成详解；关闭时（默认）侧边栏里点按钮才生成，省一次主模型调用 */
  autoDetail: boolean;
  /** 点击来源时：用系统默认浏览器打开，或在侧边栏的阅读视图里打开 */
  openSource: "browser" | "reader";
  /** 侧边栏宽度（像素），拖动左边缘调整 */
  drawerWidth: number;
  /** 离开还在回答的地图时：每次询问、终止，或在后台继续 */
  onLeave: "ask" | "stop" | "background";
  /** 明暗：深色（新用户默认）、浅色或跟随系统；写到 html 的 data-theme，令牌在 styles/tokens.css */
  theme: Theme;
  /** 配色方案：墨色为默认，其余见 PALETTES；写到 html 的 data-palette，令牌在 styles/tokens.css */
  palette: Palette;
  /** 首页红梅的花瓣飘落；关闭后不再生成花瓣 */
  petals: boolean;
  /** 输入框旁的回答偏好：回答风格、来源偏好与时间范围 */
  prefs: Prefs;
}

export const DEFAULT_PREFS: Prefs = { style: "auto", customStyle: "", sources: "auto", time: "auto" };

/** 存档里的偏好逐项校验，不认识的值回到默认 */
function cleanPrefs(v: unknown): Prefs {
  const p = (v && typeof v === "object" ? v : {}) as Partial<Prefs>;
  return {
    style: p.style === "concise" || p.style === "plain" || p.style === "deep" || p.style === "custom" ? p.style : "auto",
    customStyle: typeof p.customStyle === "string" ? p.customStyle : "",
    sources: p.sources === "official" ? "official" : "auto",
    time: p.time === "d7" || p.time === "m1" ? p.time : "auto",
  };
}

export const PALETTES = [
  { id: "ink", label: "墨色", swatch: "#60646c" },
  { id: "indigo", label: "靛青", swatch: "#3e63dd" },
  { id: "teal", label: "石青", swatch: "#12a594" },
  { id: "pine", label: "松绿", swatch: "#29a383" },
  { id: "rouge", label: "胭脂", swatch: "#e93d82" },
  { id: "plum", label: "黛紫", swatch: "#6e56cf" },
] as const;
export type Palette = (typeof PALETTES)[number]["id"];

export const THEMES = [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const;
export type Theme = (typeof THEMES)[number][0];

export const DRAWER_MIN = 360;
export const DRAWER_DEFAULT = 420;
/** 侧边栏最宽不超过窗口的 60%，给画布留出位置 */
export const clampDrawer = (w: number) => Math.round(Math.max(DRAWER_MIN, Math.min(w, Math.max(DRAWER_MIN, innerWidth * 0.6))));

interface SettingsState extends Settings {
  open: boolean;
}

export const useSettings = create<SettingsState>()(
  persist(
    (): SettingsState => ({ searchKey: "", llmKey: "", model: DEFAULT_MAIN_MODEL, autoCollapse: false, autoDetail: false, openSource: "browser", drawerWidth: DRAWER_DEFAULT, onLeave: "background", theme: "dark", palette: "ink", petals: true, prefs: DEFAULT_PREFS, open: false }),
    {
      name: "zds-settings",
      version: 3,
      // 版本 2：「切换节点时收起上一个节点的要点」默认改为保持展开（用户要求），老用户也改一次
      // 版本 3：回答风格新增「自动」并设为默认，原来默认的「简洁明了」改为自动（用户反馈简洁明了答得太少），其他选择保留
      migrate: (persisted, version) => {
        let s = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 2) s = { ...s, autoCollapse: false };
        if (version < 3 && s.prefs?.style === "concise") s = { ...s, prefs: { ...s.prefs, style: "auto" } };
        return s as SettingsState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: ({ searchKey, llmKey, model, autoCollapse, autoDetail, openSource, drawerWidth, onLeave, theme, palette, petals, prefs }) => ({ searchKey, llmKey, model, autoCollapse, autoDetail, openSource, drawerWidth, onLeave, theme, palette, petals, prefs }),
      // 已下线或在设置页隐藏的模型回到默认值（2026-10 起混元隐藏，统一用 DeepSeek Flash）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        const model = VISIBLE_MODELS.some((m) => m.id === p.model) ? p.model! : DEFAULT_MAIN_MODEL;
        const openSource = p.openSource === "reader" ? "reader" : "browser";
        const drawerWidth = typeof p.drawerWidth === "number" && Number.isFinite(p.drawerWidth) ? p.drawerWidth : DRAWER_DEFAULT;
        const onLeave = p.onLeave === "stop" || p.onLeave === "ask" ? p.onLeave : "background";
        // 新用户默认深色；存过设置的保持原样，存档里没有明暗（加这个选项之前存的）说明一直跟随系统
        const theme = THEMES.some(([t]) => t === p.theme) ? p.theme! : persisted ? "system" : current.theme;
        const palette = PALETTES.some((x) => x.id === p.palette) ? p.palette! : "ink";
        const petals = p.petals !== false;
        return { ...current, ...p, model, openSource, drawerWidth, onLeave, theme, palette, petals, prefs: cleanPrefs(p.prefs) };
      },
    },
  ),
);

export const settingsActions = {
  /** 设置即改即存：persist 中间件会把变更写入本机存储 */
  update: (s: Partial<Settings>) => useSettings.setState(s),
  setPrefs: (p: Partial<Prefs>) => useSettings.setState((s) => ({ prefs: { ...s.prefs, ...p } })),
  open: () => useSettings.setState({ open: true }),
  close: () => useSettings.setState({ open: false }),
};

/** 示例模式：只在开发环境通过 VITE_PROVIDERS=mock 打开，不出现在发布版本里 */
export const MOCK_MODE = import.meta.env.DEV && import.meta.env.VITE_PROVIDERS === "mock";

export const isConfigured = (s: Settings, search: boolean) => MOCK_MODE || (!!s.llmKey && (!search || !!s.searchKey));

export function maskKey(key: string) {
  const k = key.trim();
  return k.length <= 10 ? "已填写" : `${k.slice(0, 5)}…${k.slice(-4)}`;
}
