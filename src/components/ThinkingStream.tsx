import { useEffect, useRef, useState } from "react";

// 模型思考过程的滚动窗口：目的是让用户感到模型正在输出，不要求看清每个字。
// 收到的思考先进缓冲区，按稳定的速度一小撮一小撮写出来（每撮淡入）；
// 窗口不是写满一行跳一行，而是一直以很慢的速度往上漂、追着最新一行，上下两头渐隐并带一点景深模糊。

/** 每隔多久写出一小撮：约每秒 12 个字 */
const TICK_MS = 160;
/** 写出动画结束后并回普通文字，页面里不留一堆动画节点 */
const SETTLE_MS = 1300;
/** 滚动追赶：每秒追上剩余距离的这个比例，但不低于最低速度（像素 / 秒） */
const FOLLOW_RATE = 1.1;
const FOLLOW_MIN = 6;
/** 中途挂载时只从最后这么多字开始写 */
const CATCH_UP_TAIL = 40;

type Chunk = { key: number; text: string; at: number };

export function ThinkingStream({ text, lines = 4, className = "" }: { text: string; lines?: number; className?: string }) {
  // 换行与多余空白合并成一段连续的文字流
  const flow = text.replace(/\s+/g, " ").trim();
  const source = useRef(flow);
  source.current = flow;
  // 中途才挂载（比如生成到一半打开侧栏）时，之前的内容直接放好，只从最后一小段开始写，不从头补
  const [view, setView] = useState<{ written: number; settled: string; fresh: Chunk[] }>(() => {
    const skip = Math.max(0, flow.length - CATCH_UP_TAIL);
    return { written: skip, settled: flow.slice(0, skip), fresh: [] };
  });
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  // 写出：积压越多每撮越大，但始终是一撮一撮地来
  useEffect(() => {
    const id = window.setInterval(() => {
      setView((v) => {
        const all = source.current;
        if (all.length < v.written) return { written: 0, settled: "", fresh: [] }; // 新一轮思考
        const now = performance.now();
        const old = v.fresh.filter((c) => now - c.at > SETTLE_MS);
        let next = old.length ? { ...v, settled: v.settled + old.map((c) => c.text).join(""), fresh: v.fresh.filter((c) => now - c.at <= SETTLE_MS) } : v;
        const backlog = all.length - next.written;
        if (backlog > 0) {
          const n = Math.min(backlog, backlog > 200 ? 6 : backlog > 40 ? 3 : 2);
          next = { ...next, written: next.written + n, fresh: [...next.fresh, { key: ++seq.current, text: all.slice(next.written, next.written + n), at: now }] };
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // 滚动：目标是让最新一行停在下沿渐隐区上方；当前位置以“离得越远越快、有下限”的速度连续追过去
  useEffect(() => {
    let raf = 0, offset = -1, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const b = box.current, el = inner.current;
      if (b && el) {
        const target = Math.max(0, el.offsetHeight - b.clientHeight);
        // 第一帧直接对准（中途挂载时已有不少内容），之后再连续追赶
        const gap = offset < 0 ? 0 : target - offset;
        if (offset < 0 || gap < 0) offset = target;
        else if (gap > 0) offset += Math.min(gap, Math.max(FOLLOW_MIN, gap * FOLLOW_RATE) * dt);
        el.style.transform = `translate3d(0, ${-offset}px, 0)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`thinking-wrap ${className}`} aria-hidden="true">
      <div ref={box} className="thinking" style={{ "--lines": lines } as React.CSSProperties}>
        <div ref={inner} className="thinking-text">
          {view.settled}
          {view.fresh.map((c) => <span key={c.key} className="ink">{c.text}</span>)}
        </div>
      </div>
    </div>
  );
}
