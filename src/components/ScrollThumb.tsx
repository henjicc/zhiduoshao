import { useEffect, useRef, type RefObject } from "react";

/**
 * 细的自绘滚动条，回答卡片与首页「最近」列表共用。原生滚动条隐藏（它的滑块做不了淡入淡出），
 * 滑块画在滚动区域旁边（父元素要定位，位置由各处样式定）；悬停父元素或正在滚动时淡入，停下 0.8 秒后淡出；可以拖动。
 * 同时给滚动区域加 has-more（下面还有内容）、is-scrolled（已往下滚）两个类，供底部羽化等样式使用。
 * 拖动时按父元素的缩放比例换算位移，画布缩放后也跟手。
 */
export function ScrollThumb({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const el = ref.current;
    if (!box || !el) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      const { scrollTop, scrollHeight, clientHeight } = box;
      const h = Math.max(24, (clientHeight * clientHeight) / scrollHeight);
      const travel = scrollHeight > clientHeight ? (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h) : 0;
      el.style.height = `${h}px`;
      el.style.transform = `translateY(${box.offsetTop + travel}px)`;
      // 给滚动区域标出状态，样式据此做底部羽化（下面还有内容）和顶部固定行下沿的淡出（已经往下滚了）
      box.classList.toggle("has-more", scrollTop + clientHeight < scrollHeight - 1);
      box.classList.toggle("is-scrolled", scrollTop > 0);
    };
    const onScroll = () => {
      place();
      el.classList.add("is-active");
      clearTimeout(idle);
      idle = setTimeout(() => el.classList.remove("is-active"), 800);
    };
    place();
    box.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(place);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    return () => {
      box.removeEventListener("scroll", onScroll);
      ro.disconnect();
      clearTimeout(idle);
      box.classList.remove("has-more", "is-scrolled");
    };
  }, [scroller]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = scroller.current;
    if (e.button !== 0 || !box) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const y0 = e.clientY;
    const top0 = box.scrollTop;
    const zoom = box.getBoundingClientRect().height / box.offsetHeight || 1;
    const ratio = (box.scrollHeight - box.clientHeight) / Math.max(1, box.clientHeight - el.offsetHeight);
    const move = (ev: PointerEvent) => { box.scrollTop = top0 + ((ev.clientY - y0) / zoom) * ratio; };
    const up = () => {
      el.classList.remove("is-drag");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-drag");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return <div ref={ref} className="scroll-thumb" aria-hidden onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()} />;
}
