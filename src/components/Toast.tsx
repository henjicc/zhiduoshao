import { useEffect, useState } from "react";
import { dismissToast, useToast } from "../store/toast.ts";

/** 底部居中的轻提示；悬停时不自动消失，方便点「撤销」 */
export function Toast() {
  const t = useToast((s) => s.current);
  const [on, setOn] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!t) return;
    setOn(true);
    if (hover) return;
    const timer = setTimeout(() => setOn(false), t.ms);
    return () => clearTimeout(timer);
  }, [t, hover]);

  return (
    <div className={`toast${on ? " is-on" : ""}`} role="status" aria-live="polite"
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <span>{t?.msg}</span>
      {t?.action && (
        <button type="button" className="toast-action" tabIndex={on ? 0 : -1}
          onClick={() => { t.action!.run(); setOn(false); dismissToast(); }}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}
