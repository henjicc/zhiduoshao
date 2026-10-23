import { AlignLeft, ArrowLeft, ChevronRight, Maximize, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Canvas, useCrumbs } from "../canvas/Canvas.tsx";
import { short } from "../lib/format.ts";
import { screenTransition, swapScreen } from "../lib/transition.ts";
import { useHistory } from "../history/store.ts";
import { clampDrawer, settingsActions, useSettings } from "../settings/store.ts";
import { actions, fit, isReady, useGraph, zoomAt } from "../store/graph.ts";
import { CitePopover } from "./CitePopover.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { SearchToggle } from "./common.tsx";
import { PrefsMenu } from "./PrefsMenu.tsx";
import { Drawer } from "./Drawer.tsx";
import { HistoryButton } from "./History.tsx";
import { SummarySheet } from "./SummarySheet.tsx";
import { drag, WindowControls } from "./TitleBar.tsx";
import "../styles/workspace.css";

function Topbar() {
  const crumbs = useCrumbs();
  const hasAnswers = useGraph((s) => Object.values(s.nodes).some(isReady));
  return (
    <header className="topbar" {...drag}>
      <button type="button" className="icon-btn topbar-back" aria-label="回到首页" onClick={() => actions.leave(() => swapScreen(actions.goHome))}>
        <ArrowLeft size={16} strokeWidth={1.6} />
      </button>
      <span className="topbar-sep" aria-hidden="true" {...drag} />
      <nav className="crumbs" aria-label="当前路径" {...drag}>
        {crumbs.map((n, i) => (
          <span key={n.id} className="crumb-item">
            {i > 0 && <ChevronRight className="crumb-sep" size={13} strokeWidth={1.6} aria-hidden="true" />}
            <button type="button" className="crumb" aria-current={i === crumbs.length - 1 || undefined} onClick={() => actions.activate(n.id)}>
              {short(n.q.replace(/[？?]$/, ""), 18)}
            </button>
          </span>
        ))}
      </nav>
      <div className="topbar-actions">
        <SearchToggle compact />
        <PrefsMenu compact />
        <button type="button" className="btn" onClick={actions.openSummary} disabled={!hasAnswers}>
          <AlignLeft size={14} strokeWidth={1.6} />
          <span className="btn-label">总结</span>
        </button>
        <HistoryButton />
        <button type="button" className="icon-btn" aria-label="设置" onClick={settingsActions.open}>
          <Settings size={16} strokeWidth={1.6} />
        </button>
      </div>
      <WindowControls />
    </header>
  );
}

function ZoomControls() {
  const s = useGraph((st) => st.view.s);
  const drawer = useGraph((st) => !!st.drawerId);
  const center = () => [innerWidth / 2, innerHeight / 2] as const;
  return (
    <div className={`zoom${drawer ? " with-drawer" : ""}`} role="group" aria-label="缩放">
      <button type="button" className="icon-btn" aria-label="缩小" onClick={() => zoomAt(1 / 1.2, ...center(), true)}><Minus size={15} strokeWidth={1.6} /></button>
      <button type="button" className="zoom-value" aria-label="重置为 100%" onClick={() => zoomAt(1 / s, ...center(), true)}>{Math.round(s * 100)}%</button>
      <button type="button" className="icon-btn" aria-label="放大" onClick={() => zoomAt(1.2, ...center(), true)}><Plus size={15} strokeWidth={1.6} /></button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="icon-btn" aria-label="适应画布" onClick={fit}><Maximize size={14} strokeWidth={1.6} /></button>
    </div>
  );
}

export function Workspace() {
  const drawerWidth = useSettings((s) => s.drawerWidth);
  const drawer = useGraph((s) => !!s.drawerId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGraph.getState();
      if (useSettings.getState().open || useHistory.getState().open) return; // 对话框自己处理按键
      if (e.key === "Escape") {
        if (s.summaryOpen) return actions.closeSummary();
        if (s.selected.length) return actions.setSelected([]);
        if (s.drawerId) return actions.closeDrawer();
        return;
      }
      if ((e.target as HTMLElement).matches("input, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        actions.setSelected(s.visible.filter((id) => isReady(s.nodes[id])));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // 挂载时定下进场方式并保持不变：在页面切换中挂载就交给过渡淡入，不再自己播动画
  const [intro] = useState(() => {
    const vt = screenTransition();
    return vt === "hero" ? "enter-hero" : vt ? "enter-vt" : "enter-self";
  });

  return (
    <div className={`workspace ${intro}${drawer ? " has-drawer" : ""}`} style={{ "--drawer-w": `${clampDrawer(drawerWidth)}px` } as React.CSSProperties}>
      <Topbar />
      <Canvas />
      <CommandPalette />
      <Drawer />
      <ZoomControls />
      <SummarySheet />
      <CitePopover />
    </div>
  );
}
