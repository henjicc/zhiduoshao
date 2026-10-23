import { useEffect, useState } from "react";

/** 弹层的进退场：关闭时先保持挂载并标记 closing，播完退场动画再卸载。
 * ms 与样式里的退场时长（--t-mid）一致。 */
export function usePresence(open: boolean, ms = 220) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}
