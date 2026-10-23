import { LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import { ImageError, MAX_IMAGES, prepareImage } from "../lib/image.ts";
import { toast } from "../store/toast.ts";

// 提问框里的附图：选择、粘贴、拖入三种方式，本地压缩后以 data URL 保存。

export interface Attachment { id: number; url: string | null }

let seq = 0;

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const count = useRef(0);
  count.current = items.length;

  const add = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    const room = MAX_IMAGES - count.current;
    if (room <= 0) return toast(`最多附 ${MAX_IMAGES} 张图片`);
    if (images.length > room) toast(`最多附 ${MAX_IMAGES} 张图片，已添加前 ${room} 张`);
    for (const file of images.slice(0, room)) {
      const id = ++seq;
      count.current++;
      setItems((list) => [...list, { id, url: null }]);
      prepareImage(file).then(
        (url) => setItems((list) => list.map((a) => (a.id === id ? { ...a, url } : a))),
        (err) => {
          setItems((list) => list.filter((a) => a.id !== id));
          toast(err instanceof ImageError ? err.message : "图片处理失败");
        },
      );
    }
  };

  return {
    items,
    add,
    remove: (id: number) => setItems((list) => list.filter((a) => a.id !== id)),
    clear: () => setItems([]),
    /** 全部处理完成后的图片 */
    ready: items.every((a) => a.url) ? items.map((a) => a.url!) : null,
    full: items.length >= MAX_IMAGES,
  };
}

export function AttachmentStrip({ items, onRemove }: { items: Attachment[]; onRemove: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <ul className="attach" aria-label="已附图片">
      {items.map((a, i) => (
        <li key={a.id} className={`attach-item${a.url ? "" : " is-loading"}`}>
          {a.url ? <img src={a.url} alt={`图片 ${i + 1}`} /> : <LoaderCircle className="spin" size={16} strokeWidth={1.6} aria-label="处理中" />}
          <button type="button" className="attach-del" aria-label={`移除图片 ${i + 1}`} onClick={() => onRemove(a.id)}>
            <X size={12} strokeWidth={2} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 拖入文件时是否带有文件（拖文字、链接时不响应） */
export const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
