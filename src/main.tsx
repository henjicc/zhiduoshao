import "./henjiProbe.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HistoryPanel } from "./components/History.tsx";
import { Home } from "./components/Home.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { LeaveDialog } from "./components/LeaveDialog.tsx";
import { useWindowFocus } from "./components/TitleBar.tsx";
import { Toast } from "./components/Toast.tsx";
import { Tooltip } from "./components/Tooltip.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { IN_APP } from "./core/http.ts";
import { startAutosave } from "./history/store.ts";
import { startMemory } from "./memory/run.ts";
import { useGraph } from "./store/graph.ts";
import { useSettings, type Palette, type Theme } from "./settings/store.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/panels.css";

// 桌面应用里屏蔽 WebView 自带的右键菜单（返回、刷新、另存为……），输入框保留复制粘贴菜单
if (IN_APP && !import.meta.env.DEV) {
  addEventListener("contextmenu", (e) => {
    if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
  });
}

startAutosave();
startMemory(() => useGraph.getState().map?.id ?? null);

function App() {
  const screen = useGraph((s) => s.screen);
  useWindowFocus();
  return (
    <>
      {screen === "home" ? <Home /> : <Workspace />}
      <HistoryPanel />
      <SettingsDialog />
      <LeaveDialog />
      <Toast />
      <Tooltip />
    </>
  );
}

// 配色写到 html 的 data-palette，令牌随之切换（styles/tokens.css）；首次渲染前就设好，避免先闪一下默认配色
const applyPalette = (p: Palette) => {
  if (p === "ink") delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = p;
};
applyPalette(useSettings.getState().palette);
// 明暗同理：跟随系统时不写，由样式里的 prefers-color-scheme 决定
const applyTheme = (t: Theme) => {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
};
applyTheme(useSettings.getState().theme);
useSettings.subscribe((s) => { applyPalette(s.palette); applyTheme(s.theme); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
