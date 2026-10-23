import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Prefs } from "../core/protocol.ts";
import { settingsActions, useSettings } from "../settings/store.ts";
import { memoryActions, useMemory } from "../memory/store.ts";
import { useGraph } from "../store/graph.ts";
import { usePresence } from "./presence.ts";

const STYLES: [Prefs["style"], string][] = [["concise", "简洁明了"], ["plain", "通俗易懂"], ["deep", "详细深入"], ["custom", "自定义"]];
const SOURCES: [Prefs["sources"], string][] = [["auto", "自动"], ["official", "权威优先"]];
const TIMES: [Prefs["time"], string][] = [["auto", "自动"], ["d7", "近一周"], ["m1", "近一个月"]];

/** 按钮上显示当前风格，来源与时间不是自动时也带上 */
function summary(p: Prefs) {
  const style = p.style === "custom" && p.customStyle.trim() ? p.customStyle.trim().slice(0, 6) : STYLES.find(([v]) => v === p.style)![1];
  const extra = [p.sources !== "auto" && "权威优先", TIMES.find(([v]) => v === p.time && v !== "auto")?.[1]].filter(Boolean);
  return [style, ...extra].join("、");
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="prefs-row">
      <span id={id} className="prefs-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => value !== v && onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

/** 画布里多一行：这张地图用不用个人记忆（不用时既不记录，也不用记忆作答）；总开关关着或在首页时不显示 */
function MapMemory() {
  const mapId = useGraph((s) => s.map?.id);
  const enabled = useMemory((s) => s.enabled);
  const off = useMemory((s) => !!mapId && s.offMaps.includes(mapId));
  if (!mapId || !enabled) return null;
  return <Choice label="记忆" options={[["on", "使用"], ["off", "这张地图不用"]]} value={off ? "off" : "on"} onChange={(v) => memoryActions.toggleMap(mapId, v === "off")} />;
}

/** 输入框旁的回答偏好：回答风格、来源偏好、时间范围；选了即存，之后的提问都按它来 */
export function PrefsMenu({ compact = false }: { compact?: boolean }) {
  const prefs = useSettings((s) => s.prefs);
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const custom = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [open]);

  return (
    <div className="prefs" ref={ref}>
      <button type="button" className="toggle" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={15} strokeWidth={1.6} />
        <span className={compact ? "toggle-label" : undefined}>{summary(prefs)}</span>
      </button>
      {mounted && (
        <div className={`prefs-pop${closing ? " is-closing" : ""}`} role="dialog" aria-label="回答偏好">
          <Choice label="回答风格" options={STYLES} value={prefs.style} onChange={(style) => {
            settingsActions.setPrefs({ style });
            if (style === "custom") requestAnimationFrame(() => custom.current?.focus());
          }} />
          {prefs.style === "custom" && (
            <input
              ref={custom}
              className="prefs-input"
              aria-label="自定义回答风格"
              placeholder="自定义回答风格"
              maxLength={100}
              value={prefs.customStyle}
              onChange={(e) => settingsActions.setPrefs({ customStyle: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setOpen(false); } }}
            />
          )}
          <Choice label="来源" options={SOURCES} value={prefs.sources} onChange={(sources) => settingsActions.setPrefs({ sources })} />
          <Choice label="时间" options={TIMES} value={prefs.time} onChange={(time) => settingsActions.setPrefs({ time })} />
          <MapMemory />
        </div>
      )}
    </div>
  );
}
