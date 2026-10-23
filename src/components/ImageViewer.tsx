import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./presence.ts";

/** 查看大图：点遮罩或按 Esc 关闭，左右键切换 */
export function ImageViewer({ images, index, onChange, onClose }: { images: string[]; index: number | null; onChange: (i: number) => void; onClose: () => void }) {
  const p = usePresence(index !== null);
  const last = index ?? 0;

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight" && images.length > 1) onChange((index + 1) % images.length);
      else if (e.key === "ArrowLeft" && images.length > 1) onChange((index - 1 + images.length) % images.length);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [index, images.length, onChange, onClose]);

  if (!p.mounted || !images[last]) return null;
  return createPortal(
    <div className={`viewer${p.closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="查看图片" onClick={onClose}>
      <img key={last} src={images[last]} alt={`图片 ${last + 1}`} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn viewer-close" aria-label="关闭" onClick={onClose}><X size={18} strokeWidth={1.6} /></button>
      {images.length > 1 && (
        <>
          <button type="button" className="icon-btn viewer-prev" aria-label="上一张" onClick={(e) => { e.stopPropagation(); onChange((last - 1 + images.length) % images.length); }}>
            <ChevronLeft size={20} strokeWidth={1.6} />
          </button>
          <button type="button" className="icon-btn viewer-next" aria-label="下一张" onClick={(e) => { e.stopPropagation(); onChange((last + 1) % images.length); }}>
            <ChevronRight size={20} strokeWidth={1.6} />
          </button>
          <span className="viewer-count">{last + 1} / {images.length}</span>
        </>
      )}
    </div>,
    document.body,
  );
}
