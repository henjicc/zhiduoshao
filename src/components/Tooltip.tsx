import { useEffect, useRef, useState } from "react";

// 图标按钮（以及路径回看里每一步的点）的悬停提示：读取 aria-label，替代系统原生的 title 提示。
// 全局一个实例，靠事件委托工作，组件里不需要额外写什么。

const TARGET = ".icon-btn[aria-label], .wc[aria-label], .zoom-value[aria-label], .review-dot[aria-label]";
const DELAY = 500;
/** 刚看过一个提示时，移到相邻按钮立即显示 */
const WARM = 400;

interface Tip { text: string; x: number; y: number; below: boolean; key: number }

export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastHide = useRef(0);

  useEffect(() => {
    let current: Element | null = null;
    const show = (el: Element) => {
      const r = el.getBoundingClientRect();
      const below = r.bottom + 40 < innerHeight;
      setTip({ text: el.getAttribute("aria-label")!, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below, key: Date.now() });
      setOn(true);
    };
    const hide = () => {
      clearTimeout(timer.current);
      if (current) lastHide.current = Date.now();
      current = null;
      setOn(false);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element).closest?.(TARGET) ?? null;
      if (el === current) return;
      hide();
      if (!el || (el as HTMLButtonElement).disabled) return;
      current = el;
      const warm = Date.now() - lastHide.current < WARM;
      timer.current = setTimeout(() => current === el && el.isConnected && show(el), warm ? 0 : DELAY);
    };
    addEventListener("pointerover", over);
    addEventListener("pointerdown", hide, true);
    addEventListener("wheel", hide, { passive: true });
    addEventListener("keydown", hide);
    addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      removeEventListener("pointerover", over);
      removeEventListener("pointerdown", hide, true);
      removeEventListener("wheel", hide);
      removeEventListener("keydown", hide);
      removeEventListener("blur", hide);
    };
  }, []);

  // 水平方向不超出窗口
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth, left = tip.x - w / 2;
    setDx(left < 8 ? 8 - left : left + w > innerWidth - 8 ? innerWidth - 8 - (left + w) : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} role="tooltip" className={`tooltip${on ? " is-on" : ""}${tip.below ? "" : " is-above"}`}
      style={{ left: tip.x + dx, top: tip.y }}>
      {tip.text}
    </div>
  );
}
