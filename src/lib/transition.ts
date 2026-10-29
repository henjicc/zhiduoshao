import { flushSync } from "react-dom";

// 首页与画布之间的切换。
// fade：View Transitions 交叉淡入（打开历史、回首页），浏览器截取前后两帧做过渡。
// hero：首页提问框形变并位移成画布上的第一张卡片（morphToCard），手写的共享元素动画。

export type ScreenTransition = "hero" | "fade";

let running: ScreenTransition | null = null;

/** 当前是否处在页面切换中。新挂载的页面据此决定要不要播自己的进场动画：
 * 过渡本身已经淡入，再叠加会在过渡结束时从透明重播一次，看起来就是闪一下 */
export const screenTransition = () => running;

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function swapScreen(change: () => void, kind: ScreenTransition = "fade") {
  if (!document.startViewTransition || reduceMotion()) return change();
  const root = document.documentElement;
  root.dataset.vt = kind;
  running = kind;
  const t = document.startViewTransition(() => flushSync(change));
  // 窗口不可见时浏览器会因超时放弃动画（页面已切换），不算错误
  t.ready.catch(() => {});
  void t.finished.finally(() => {
    delete root.dataset.vt;
    running = null;
  });
}

/* ============ 提问框 → 第一张卡片 ============ */

const MORPH_MS = 640;
/** 交接：形变落位后，外壳内容在真实卡片上方淡出的时长 */
const HANDOFF_MS = 160;
/** 形变曲线：起步干脆、收尾很长，落位时几乎察觉不到减速的终点 */
const MORPH_CURVE = [0.32, 0.72, 0, 1] as const;
const MORPH_EASE = `cubic-bezier(${MORPH_CURVE.join(", ")})`;
const TARGET = ".node.is-root.is-placed .card";

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** CSS cubic-bezier 的 JS 版本：几何位置逐帧计算时与样式动画用同一条曲线 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t: number) => {
    if (t <= 0 || t >= 1) return t;
    let lo = 0, hi = 1, s = t;
    for (let i = 0; i < 24; i++) {
      s = (lo + hi) / 2;
      if (at(x1, x2, s) < t) lo = s; else hi = s;
    }
    return at(y1, y2, s);
  };
}
const morphEase = cubicBezier(...MORPH_CURVE);

/** 等第一张卡片测量并定位完成；超时返回 null */
async function waitForCard(frames = 30) {
  for (let i = 0; i < frames; i++) {
    const el = document.querySelector<HTMLElement>(TARGET);
    if (el && el.getBoundingClientRect().width > 0) return el;
    await nextFrame();
  }
  return null;
}

/** 外观（不含几何）：圆角、边框色、底色、阴影，交给样式动画插值 */
function looks(el: HTMLElement): Keyframe {
  const cs = getComputedStyle(el);
  return { borderRadius: cs.borderRadius, borderColor: cs.borderTopColor, backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow };
}

function place(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

/** 一层内容：固定为原尺寸，左上对齐，随外壳一起缩放 */
function layer(content: HTMLElement, width: number) {
  const el = document.createElement("div");
  el.className = "morph-layer";
  el.style.width = `${width}px`;
  el.append(content);
  return el;
}

/** 输入框第一行文字的左端、行中线位置与字号 */
function textOrigin(area: HTMLTextAreaElement) {
  const r = area.getBoundingClientRect();
  const cs = getComputedStyle(area);
  return { x: r.left + parseFloat(cs.paddingLeft), y: r.top + parseFloat(cs.paddingTop) - area.scrollTop + parseFloat(cs.lineHeight) / 2, size: parseFloat(cs.fontSize) };
}

/** 问题行的飞行层：克隆真实问题行盖在它上面；follow 按进度 e 从输入框文字处缩放、平移到问题行当前所在位置 */
function flyingHead(head: HTMLElement) {
  const el = head.cloneNode(true) as HTMLElement;
  el.classList.add("morph-head");
  // 克隆脱离了节点，按节点状态（如当前节点）变化的问题字色要照抄过来，交接时才不跳色
  const q = head.querySelector(".card-q");
  const qClone = el.querySelector<HTMLElement>(".card-q");
  if (q && qClone) qClone.style.color = getComputedStyle(q).color;
  document.body.append(el);
  return {
    el,
    follow(at: { x: number; y: number; size: number }, e: number) {
      const box = head.getBoundingClientRect();
      const q = head.querySelector<HTMLElement>(".card-q") ?? head;
      const qr = q.getBoundingClientRect();
      const cs = getComputedStyle(q);
      // 以问题文字第一行的左端、行中线为基准点对齐输入框里的文字
      const ox = qr.left - box.left, oy = qr.top - box.top + parseFloat(cs.lineHeight) / 2;
      const s = at.size / parseFloat(cs.fontSize);
      place(el, { left: box.left, top: box.top, width: box.width, height: box.height });
      el.style.transformOrigin = `${ox}px ${oy}px`;
      const dx = (at.x - (box.left + ox)) * (1 - e), dy = (at.y - (box.top + oy)) * (1 - e);
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + (s - 1) * (1 - e)})`;
    },
  };
}

/**
 * 提问框形变成第一张卡片：
 * 1. 首页克隆成一层「残影」盖在新页面上淡出，其余元素不会突然消失；
 * 2. 一个外壳从提问框连续形变到卡片：位置和尺寸逐帧追踪真实卡片的当前位置
 *    （第一张卡片以纵向中心为锚点，内容变化会让它上下移动，只瞄准起始位置会在落位时跳一下），
 *    圆角、边框、底色、阴影用同一条曲线的样式动画；
 * 3. 外壳里提问框的内容随形变缩小淡出，卡片内容（克隆）从放大状态收拢淡入；
 * 4. 卡片上方的问题行另做一层，从输入框里文字的位置缩小飞到问题行的位置并淡入，输入的问题看起来是直接移上去的；
 * 5. 落位后真实卡片出现在外壳下方：外壳的盒子（底色、边框、阴影）与卡片完全重合，立即撤掉；
 *    只让内容层淡出，内容有差异也只是一次柔和的交叉淡化。盒子若一起淡出，两层阴影和边框会叠加，看起来先变深再变浅。
 *    问题行那一层与真实问题行逐像素重合，交接时直接换掉。
 */
export async function morphToCard(source: HTMLElement, change: () => void) {
  const page = source.closest<HTMLElement>("main");
  if (reduceMotion() || !source.animate || !page) return change();

  const root = document.documentElement;
  const from = source.getBoundingClientRect();
  const fromLooks = looks(source);
  const typedArea = source.querySelector("textarea");
  const typedAt = typedArea && textOrigin(typedArea);

  const ghost = page.cloneNode(true) as HTMLElement;
  ghost.classList.add("morph-ghost");
  ghost.querySelector<HTMLElement>(".ask")?.style.setProperty("visibility", "hidden");

  // 克隆不带输入框的当前值，手动补上
  const fromContent = source.cloneNode(true) as HTMLElement;
  const typed = source.querySelector("textarea")?.value ?? "";
  const area = fromContent.querySelector("textarea");
  if (area) area.value = typed;
  fromContent.classList.add("morph-content");
  const fromLayer = layer(fromContent, from.width);

  const shell = document.createElement("div");
  shell.className = "morph-shell";
  place(shell, from);
  Object.assign(shell.style, fromLooks);
  shell.append(fromLayer);

  document.body.append(ghost, shell);
  root.dataset.morph = "";
  running = "hero";
  try {
    flushSync(change);
  } finally {
    running = null;
  }

  ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  const card = await waitForCard();
  const head = card?.parentElement?.querySelector<HTMLElement>(".card-head") ?? null;
  const flyer = head && typedAt ? flyingHead(head) : null;
  const cleanup = () => {
    delete root.dataset.morph;
    ghost.remove();
    shell.remove();
    flyer?.el.remove();
  };
  if (!card) return cleanup();

  const toContent = card.cloneNode(true) as HTMLElement;
  toContent.classList.add("morph-content");
  const width = card.getBoundingClientRect().width;
  const toLayer = layer(toContent, width);
  shell.append(toLayer);

  const shrink = width / from.width;
  const opts = { duration: MORPH_MS, easing: MORPH_EASE, fill: "forwards" as const };
  shell.animate([fromLooks, looks(card)], opts);
  fromLayer.animate([
    { opacity: 1, transform: "scale(1)" },
    { opacity: 0, transform: `scale(${shrink})`, offset: 0.4 },
    { opacity: 0, transform: `scale(${shrink})` },
  ], opts);
  toLayer.animate([
    { opacity: 0, transform: `scale(${1 / shrink})` },
    { opacity: 0, offset: 0.2 },
    { opacity: 1, transform: "scale(1)", offset: 0.75 },
    { opacity: 1, transform: "scale(1)" },
  ], opts);
  // 与输入框里那句交叉淡化：起步时两者几乎重合，那句随外壳淡出时这句已经接上，问题始终看得见
  flyer?.el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], opts);

  // 几何：每帧读取真实卡片的当前位置，在起点与它之间按曲线插值；交接阶段继续贴住卡片
  const lerp = (a: number, b: number, e: number) => a + (b - a) * e;
  const t0 = performance.now();
  let handedOff = false;
  for (;;) {
    const now = await nextFrame();
    const p = Math.min(1, (now - t0) / MORPH_MS);
    const e = morphEase(p);
    const to = card.getBoundingClientRect();
    place(shell, { left: lerp(from.left, to.left, e), top: lerp(from.top, to.top, e), width: lerp(from.width, to.width, e), height: lerp(from.height, to.height, e) });
    if (flyer && typedAt) flyer.follow(typedAt, e);
    if (p < 1) continue;
    if (!handedOff) {
      handedOff = true;
      flyer?.el.remove();
      delete root.dataset.morph;
      for (const a of shell.getAnimations()) a.cancel();
      Object.assign(shell.style, { backgroundColor: "transparent", borderColor: "transparent", boxShadow: "none" });
      toLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOFF_MS, easing: "linear", fill: "forwards" });
    }
    if (now - t0 >= MORPH_MS + HANDOFF_MS || !card.isConnected) break;
  }
  cleanup();
}
