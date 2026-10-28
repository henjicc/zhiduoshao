import { useEffect, useId, type RefObject } from "react";

// 首页的红梅：应用图标（src-tauri/icons/app-icon.svg）去掉底板与落瓣后的花，以及从它飘落的花瓣。
// 颜色是图标的品牌色，与字标一样不随配色方案和明暗变化，所以不走 tokens.css。

const RED = "#c23d47";
const HEART = "#82192a";
const GOLD = "#efc163";
const PISTIL = "#fbe3a6";
/** 与图标相同的花瓣轮廓：根部在原点，瓣尖朝上 */
const PETAL = "M0,0C35.4,-15.72 108.56,-73.56 118,-146.72C122.72,-224.6 68.44,-262 0,-262C-68.44,-262 -122.72,-224.6 -118,-146.72C-108.56,-73.56 -35.4,-15.72 0,0Z";

/** 四瓣的旋转角与缩放，花心 (476, 484)，取自图标母版 */
const PETALS = [[200, 0.9259], [279, 0.94], [351, 0.9588], [70, 0.9353]] as const;
/** 花蕊：从花心分出的枝（x1, y1, x2, y2, 线宽）与端点（x, y, 半径） */
const STAMENS = [
  [476, 484, 450.8, 540.7, 4.6], [450.8, 540.7, 450.8, 587.7, 3], [450.8, 540.7, 415.8, 572.1, 3],
  [476, 484, 415.6, 470, 4.6], [415.6, 470, 369.4, 479, 3], [415.6, 470, 378, 441.8, 3],
  [476, 484, 470.6, 422.2, 4.6], [470.6, 422.2, 447.8, 381.1, 3], [470.6, 422.2, 485.9, 377.8, 3],
  [476, 484, 535.6, 466.9, 4.6], [535.6, 466.9, 571.6, 436.7, 3], [535.6, 466.9, 582.2, 473.4, 3],
  [476, 484, 522.5, 530.5, 4.6], [522.5, 530.5, 563.7, 571.7, 3.6], [563.7, 571.7, 607.6, 588.6, 3], [563.7, 571.7, 580.6, 615.6, 3],
] as const;
const ANTHERS = [
  [450.8, 540.7, 8.2], [450.8, 587.7, 6.2], [415.8, 572.1, 6.2], [415.6, 470, 8.2], [369.4, 479, 6.2], [378, 441.8, 6.2],
  [470.6, 422.2, 8.2], [447.8, 381.1, 6.2], [485.9, 377.8, 6.2], [535.6, 466.9, 8.2], [571.6, 436.7, 6.2], [582.2, 473.4, 6.2],
  [522.5, 530.5, 8.2], [563.7, 571.7, 8.2], [607.6, 588.6, 6.2], [580.6, 615.6, 6.2],
] as const;
/** 图标里花朵整体的构图变换 */
const COMPOSE = "translate(526 522) scale(1.02) translate(-512 -512) translate(523 508) scale(1.12) translate(-523 -508)";
/** 落瓣起点：花右下方的缺口（图标里第五瓣的位置），按视框比例 */
const GAP = { x: 0.7, y: 0.66 };

export function PlumMark({ markRef }: { markRef: RefObject<SVGSVGElement | null> }) {
  const id = useId();
  const petal = (r: number, k: number) => `translate(476 484) rotate(${r}) scale(${k})`;
  return (
    <svg ref={markRef} className="plum-mark" viewBox="190 195 590 590" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.04" /><stop offset="1" stopColor="#000" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id={`${id}h`} gradientUnits="userSpaceOnUse" cx="476" cy="484" r="104">
          <stop offset="0" stopColor={HEART} /><stop offset="0.6" stopColor={HEART} stopOpacity="0.75" /><stop offset="1" stopColor={HEART} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" /><feOffset dx="2" dy="6" result="b" />
          <feFlood floodColor="#000" floodOpacity="0.22" /><feComposite in2="b" operator="in" />
        </filter>
        <clipPath id={`${id}u`}>{PETALS.map(([r, k]) => <path key={r} d={PETAL} transform={petal(r, k)} />)}</clipPath>
      </defs>
      <g transform={COMPOSE}>
        {PETALS.map(([r, k]) => (
          <g key={r} transform={petal(r, k)}>
            <path d={PETAL} filter={`url(#${id}s)`} />
            <path d={PETAL} fill={RED} fillOpacity="0.88" />
            <path d={PETAL} fill={`url(#${id}b)`} />
          </g>
        ))}
        <circle cx="476" cy="484" r="104" fill={`url(#${id}h)`} clipPath={`url(#${id}u)`} opacity="0.85" />
        <g stroke={GOLD} strokeLinecap="round">
          {STAMENS.map(([x1, y1, x2, y2, w], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w} />)}
        </g>
        <g fill={GOLD}>{ANTHERS.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} />)}</g>
        <circle cx="476" cy="484" r="18" fill={PISTIL} />
      </g>
    </svg>
  );
}

/* ============ 落瓣 ============ */

const PETAL_SVG = `<svg viewBox="-130 -272 260 282" aria-hidden="true"><defs>
<linearGradient id="plum-pb" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".45" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
<linearGradient id="plum-pr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${HEART}" stop-opacity=".55"/><stop offset=".45" stop-color="${HEART}" stop-opacity="0"/></linearGradient>
</defs><path d="${PETAL}" fill="${RED}" fill-opacity=".92"/><path d="${PETAL}" fill="url(#plum-pr)"/><path d="${PETAL}" fill="url(#plum-pb)"/></svg>`;

/** 同屏最多几片、两片之间隔多久（秒） */
const MAX_PETALS = 4;
const GAP_S: [number, number] = [2.5, 5.5];
/** 淡入、离开时淡出的时长（秒） */
const FADE_IN = 1.4;
const FADE_OUT = 1.6;
/** 速度追随风的快慢（每秒）：越小越有惯性，花瓣不会被风一下子拽走 */
const DRAG = 0.9;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** 几条不同频率的正弦相加：连续、不重复、没有突变的「噪声」 */
const waves = (t: number, w: [number, number, number][]) => w.reduce((s, [a, f, p]) => s + a * Math.sin(t * f + p), 0);
const randWaves = (amps: number[]): [number, number, number][] => amps.map((a, i) => [a, rand(0.08, 0.2) * (i + 1), rand(0, 6.3)]);

type Petal = {
  el: HTMLElement; age: number; x: number; y: number; vx: number; vy: number;
  fall: number; rot: number; spin: number; flip: number; flipRate: number;
  turbX: [number, number, number][]; turbY: [number, number, number][];
};

/**
 * 从花的缺口不时飘出花瓣，在页面最上层（输入框之上）随风慢慢落到窗口外。
 * 风是全局的、方向会来回变；每片花瓣再叠自己的湍流，所以路线各不相同。
 * 首页卸载（提问后形变成卡片、打开历史地图）时不再生成，已有的花瓣继续飘、边飘边淡出，
 * 落瓣层挂在 body 上、不在首页里，形变时不会随首页一起消失或被残影盖住。
 */
export function usePetals(markRef: RefObject<SVGSVGElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = document.createElement("div");
    layer.className = "plum-petals";
    document.body.append(layer);

    const wind = { base: rand(-6, 10), x: randWaves([22, 12, 6]), y: randWaves([6, 3]) };
    let petals: Petal[] = [];
    let clock = 0, next = 1.5, released = -1, last = performance.now(), raf = 0;

    const spawn = () => {
      const mark = markRef.current;
      const r = mark?.getBoundingClientRect();
      if (!mark || !r || !r.width || !mark.checkVisibility?.({ visibilityProperty: true })) return;
      const size = rand(15, 22);
      const el = document.createElement("div");
      el.className = "plum-petal";
      el.style.width = `${size}px`;
      el.style.height = `${size * 1.08}px`;
      el.innerHTML = PETAL_SVG;
      layer.append(el);
      petals.push({
        el, age: 0, x: r.left + r.width * GAP.x - size / 2, y: r.top + r.height * GAP.y - size / 2,
        vx: rand(8, 18), vy: rand(4, 10), fall: rand(26, 36) * (18 / size) ** 0.3,
        rot: rand(90, 130), spin: rand(-10, 14), flip: rand(0, 6.3), flipRate: rand(0.5, 0.9),
        turbX: randWaves([rand(10, 18), rand(5, 9)]), turbY: randWaves([rand(4, 8)]),
      });
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      if (released < 0) {
        next -= dt;
        if (next <= 0 && petals.length < MAX_PETALS) { spawn(); next = rand(...GAP_S); }
      }
      const wx = wind.base + waves(clock, wind.x), wy = waves(clock, wind.y);
      const h = innerHeight, w = innerWidth;
      petals = petals.filter((p) => {
        p.age += dt;
        const tx = wx + waves(clock + p.flip, p.turbX);
        const ty = p.fall + wy + waves(clock + p.flip, p.turbY);
        p.vx += (tx - p.vx) * DRAG * dt;
        p.vy += (ty - p.vy) * DRAG * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 被风横推时转得快、翻得快，平稳下落时慢慢打旋
        const push = Math.abs(p.vx) / 30;
        p.rot += (p.spin + p.vx * 0.4) * dt;
        p.flip += p.flipRate * (1 + push) * dt;
        const out = p.y > h + 30 || p.x < -60 || p.x > w + 60;
        const fadeOut = released < 0 ? 1 : Math.max(0, 1 - (now - released) / 1000 / FADE_OUT);
        const opacity = Math.min(1, p.age / FADE_IN) * fadeOut;
        if (out || opacity <= 0 && p.age > FADE_IN) { p.el.remove(); return false; }
        p.el.style.opacity = String(opacity);
        p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg) scale(1, ${0.4 + 0.6 * Math.abs(Math.cos(p.flip))})`;
        return true;
      });
      if (released >= 0 && !petals.length) return layer.remove();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      released = performance.now();
      layer.classList.add("is-released");
      if (!petals.length) { cancelAnimationFrame(raf); layer.remove(); }
    };
  }, [markRef, active]);
}
