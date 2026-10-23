import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IN_APP } from "../core/http.ts";

// 自定义标题栏：窗口没有系统装饰，顶栏空白处通过 data-tauri-drag-region 拖动（双击最大化），
// 右侧放窗口按钮：沿用 Windows 的按钮位置与尺寸，图标与顶栏其他按钮同用 lucide、同尺寸同线宽。
// 浏览器开发时不渲染窗口按钮。

/** 放在可拖动元素上；子元素按钮不受影响 */
export const drag = IN_APP ? { "data-tauri-drag-region": "" } : {};

/** 窗口是否获得焦点：失焦时标题栏内容变淡，与系统窗口一致 */
export function useWindowFocus() {
  useEffect(() => {
    if (!IN_APP) return;
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload }) => {
      document.documentElement.classList.toggle("window-inactive", !payload);
    });
    return () => { void unlisten.then((f) => f()); };
  }, []);
}

/** 与顶栏图标按钮一致：16px 图标、线宽 1.6（24 网格）≈ 实际 1.07px。
 * 方框图形在 lucide 里比横线和叉号大一圈，缩到 13px，并用绝对线宽保持同样粗细。 */
const ICON = 16;
const STROKE = 1.6;
const BOX = 13;
const BOX_STROKE = (STROKE * ICON) / 24;

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IN_APP) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => { void win.isMaximized().then(setMaximized); });
    return () => { void unlisten.then((f) => f()); };
  }, []);

  if (!IN_APP) return null;
  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button type="button" className="wc" aria-label="最小化" onClick={() => void win.minimize()}>
        <Minus size={ICON} strokeWidth={STROKE} />
      </button>
      <button type="button" className="wc" aria-label={maximized ? "还原" : "最大化"} onClick={() => void win.toggleMaximize()}>
        {maximized
          ? <Copy size={BOX} strokeWidth={BOX_STROKE} absoluteStrokeWidth style={{ transform: "scaleX(-1)" }} />
          : <Square size={BOX} strokeWidth={BOX_STROKE} absoluteStrokeWidth />}
      </button>
      <button type="button" className="wc wc-close" aria-label="关闭" onClick={() => void win.close()}>
        <X size={ICON} strokeWidth={STROKE} />
      </button>
    </div>
  );
}
