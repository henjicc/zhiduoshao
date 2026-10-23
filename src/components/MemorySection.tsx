import { useId, useLayoutEffect, useRef } from "react";
import { MEMORY_MAX, memoryActions, useMemory } from "../memory/store.ts";

/** 设置里的「记忆」：总开关，以及记忆文本本身（就是交给模型的那段话，直接改，即改即存） */
export function MemorySection() {
  const enabled = useMemory((s) => s.enabled);
  const text = useMemory((s) => s.text);
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);

  // 高度跟着内容走，不出现内部滚动条
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text, enabled]);

  return (
    <section className="settings-section">
      <h3>记忆</h3>
      <div className="field">
        <span className="field-label" id={id}>个人记忆</span>
        <div className="segmented" role="radiogroup" aria-labelledby={id}>
          {([[true, "开启"], [false, "关闭"]] as const).map(([v, label]) => (
            <button key={label} type="button" role="radio" aria-checked={enabled === v} onClick={() => enabled !== v && memoryActions.setEnabled(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {enabled && (
        <textarea
          ref={box}
          className="memory-text"
          aria-label="记忆内容"
          placeholder="还没有记忆"
          maxLength={MEMORY_MAX}
          spellCheck={false}
          value={text}
          onChange={(e) => memoryActions.setText(e.target.value)}
        />
      )}
    </section>
  );
}
