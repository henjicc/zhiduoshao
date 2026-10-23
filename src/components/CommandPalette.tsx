import { AlignLeft, CornerDownLeft, ScanSearch, Split, Waypoints, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OpKind } from "../core/protocol.ts";
import { bounds } from "../canvas/layout.ts";
import { actions, isReady, useGraph } from "../store/graph.ts";
import { usePresence } from "./presence.ts";

const PRESETS: { op: OpKind; label: string; Icon: LucideIcon }[] = [
  { op: "summary", label: "总结", Icon: AlignLeft },
  { op: "relate", label: "找出关联", Icon: Waypoints },
  { op: "deepen", label: "深入了解", Icon: ScanSearch },
  { op: "expand", label: "扩散", Icon: Split },
];

/** 选中两个以上节点后自动出现，主动询问用户想做什么 */
export function CommandPalette() {
  const ids = useGraph((s) => s.selected.filter((id) => isReady(s.nodes[id])).join(","));
  const open = ids.split(",").filter(Boolean).length >= 2;
  const p = usePresence(open);
  // 退场时沿用最后一次的选区，面板停在原处淡出
  const last = useRef(ids);
  if (open) last.current = ids;
  return p.mounted ? <Palette ids={last.current.split(",")} closing={p.closing} /> : null;
}

function Palette({ ids, closing }: { ids: string[]; closing: boolean }) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pos = useGraph((s) => s.pos);
  const view = useGraph((s) => s.view);

  // 定位完成后才可见，此时再聚焦（visibility: hidden 的元素无法获得焦点）
  const placed = place !== null;
  useEffect(() => { if (placed) input.current?.focus({ preventScroll: true }); }, [placed]);

  // 贴着选区右侧放置，空间不够时放到左侧或居中
  useLayoutEffect(() => {
    const el = ref.current;
    const boxes = ids.map((id) => pos[id]).filter(Boolean);
    if (!el || !boxes.length) return;
    const b = bounds(boxes);
    const w = el.offsetWidth, h = el.offsetHeight;
    const right = b.x2 * view.s + view.x, left = b.x1 * view.s + view.x, top = b.y1 * view.s + view.y;
    let x = right + 16;
    if (x + w > innerWidth - 12) x = left - w - 16;
    if (x < 12) x = Math.min(innerWidth - w - 12, Math.max(12, (left + right) / 2 - w / 2));
    setPlace({ left: x, top: Math.min(innerHeight - h - 12, Math.max(64, top)) });
  }, [ids.join(","), pos, view]);

  const run = (op: OpKind) => actions.runOp(op, op === "custom" ? text.trim() : undefined);

  return (
    <div ref={ref} className={`command${closing ? " is-closing" : ""}`} inert={closing} role="dialog" aria-label="对选中节点的操作" style={place ?? { visibility: "hidden" }}>
      <div className="command-count">已选 {ids.length} 个节点</div>
      <form
        className="command-input"
        onSubmit={(e) => {
          e.preventDefault();
          run(text.trim() ? "custom" : PRESETS[index].op);
        }}
      >
        <label className="visually-hidden" htmlFor="command-text">对选中的节点做什么</label>
        <input
          id="command-text"
          ref={input}
          placeholder="对选中的节点做什么？"
          value={text}
          maxLength={500}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + PRESETS.length) % PRESETS.length);
            } else if (!text && /^[1-4]$/.test(e.key)) {
              e.preventDefault();
              run(PRESETS[Number(e.key) - 1].op);
            }
          }}
        />
        <CornerDownLeft size={14} strokeWidth={1.6} className="command-enter" aria-hidden="true" />
      </form>
      <div className="command-presets" role="listbox" aria-label="预设操作">
        {PRESETS.map(({ op, label, Icon }, i) => (
          <button
            key={op}
            type="button"
            role="option"
            className="preset"
            aria-selected={!text && i === index}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(op)}
          >
            <Icon size={15} strokeWidth={1.6} />
            <span>{label}</span>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
