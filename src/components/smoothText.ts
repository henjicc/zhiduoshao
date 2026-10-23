import { useEffect, useRef, useState } from "react";

/** 正文攒够这么多字才开始放：开头不至于一两个字一两个字地往外挤 */
const START_AT = 20;
/** 一小段最多几个字（遇到标点提前断开） */
const PHRASE_MAX = 6;
/** 放出间隔：积压多时缩短，但不低于下限，整体从容不赶 */
const GAP_MS = 320;
const GAP_MIN_MS = 200;
/** 一小段的浮现动画结束后并回普通文字，页面里不留一堆动画节点 */
const SETTLE_MS = 1700;
/** 要点：结论放完先停一拍，再一条条出现 */
const POINTS_PAUSE_MS = 900;
const POINTS_GAP_MS = 650;

const PUNCT = /[，。、；：？！,.;:?!）)」』]/;

/**
 * 从 text[from] 起切出下一小段：遇到标点或满 PHRASE_MAX 个字断开；
 * 不切在引用角标「[12]」或加粗标记「**…**」中间，免得原样露出符号。
 * 不是最后一段（final 为假）而且既没遇到标点也没攒满时返回 null，等后面的字
 */
export function nextPhrase(text: string, from: number, final: boolean): string | null {
  let end = from;
  while (end < text.length) {
    const ch = text[end++];
    if (PUNCT.test(ch) || end - from >= PHRASE_MAX) break;
  }
  // 紧跟着的引用角标并进来
  for (let m: RegExpExecArray | null; (m = /^\[\d+\]/.exec(text.slice(end))); ) end += m[0].length;
  // 角标没写完（「[1」）或停在半个「*」上：退回到它前面
  const open = /\[\d*$|\*+$/.exec(text.slice(from, end));
  if (open && !(final && end >= text.length)) end = from + open.index;
  // 加粗没闭合：延伸到闭合处
  const before = text.slice(0, end).split("**").length - 1;
  if (before % 2) {
    const close = text.indexOf("**", end);
    if (close < 0) return final ? text.slice(from) || null : null;
    end = close + 2;
  }
  if (end <= from) return null;
  const s = text.slice(from, end);
  const complete = PUNCT.test(s) || end - from >= PHRASE_MAX || /\]$/.test(s);
  return complete || final ? s : null;
}

export type Phrase = { key: number; text: string };

/**
 * 流式正文分段浮现：收到的字先攒着，攒够一句左右再按小段、以稳定的节奏放出来，每段由 CSS 做淡入；
 * 放完一阵子的段落并回 settled。live 为假（打开历史地图）时直接全部显示，不重播。
 * final 表示这段文字已经写完：最后不够一段的尾巴也放出来
 */
export function usePhraseReveal(text: string, final: boolean, live: boolean) {
  const [state, setState] = useState<{ cut: number; settled: string; fresh: (Phrase & { at: number })[] }>(
    () => ({ cut: live ? 0 : text.length, settled: live ? "" : text, fresh: [] }),
  );
  const input = useRef({ text, final });
  input.current = { text, final };
  const seq = useRef(0);
  const cut = useRef(state.cut);

  // 重新回答：文字比已经放出的还短，从头来
  if (state.cut > text.length) {
    cut.current = 0;
    setState({ cut: 0, settled: "", fresh: [] });
  }

  useEffect(() => {
    if (!live) return;
    let timer = 0;
    const pump = () => {
      const { text: t, final: f } = input.current;
      setState((s) => {
        const now = performance.now();
        const old = s.fresh.filter((p) => now - p.at > SETTLE_MS);
        let next = old.length ? { ...s, settled: s.settled + old.map((p) => p.text).join(""), fresh: s.fresh.filter((p) => now - p.at <= SETTLE_MS) } : s;
        if (next.cut === 0 && t.length < START_AT && !f) return next;
        const p = next.cut < t.length ? nextPhrase(t, next.cut, f) : null;
        if (p) next = { ...next, cut: next.cut + p.length, fresh: [...next.fresh, { key: ++seq.current, text: p, at: now }] };
        cut.current = next.cut;
        return next;
      });
      const backlog = (input.current.text.length - cut.current) / PHRASE_MAX;
      timer = window.setTimeout(pump, Math.max(GAP_MIN_MS, GAP_MS - backlog * 20));
    };
    timer = window.setTimeout(pump, 0);
    return () => clearTimeout(timer);
  }, [live]);

  const done = state.cut >= text.length && final;
  return { settled: state.settled, fresh: state.fresh as Phrase[], done };
}

/** 要点逐条出现：start 之后先停一拍，再每隔一段时间多显示一条；live 为假时全部直接显示 */
export function useStagger(count: number, start: boolean, live: boolean) {
  const [shown, setShown] = useState(live ? 0 : count);
  useEffect(() => {
    if (!live) return setShown(count);
    if (!start || shown >= count) return;
    const t = window.setTimeout(() => setShown((x) => x + 1), shown === 0 ? POINTS_PAUSE_MS : POINTS_GAP_MS);
    return () => clearTimeout(t);
  }, [count, start, live, shown]);
  return Math.min(shown, count);
}

/** 把一句话切成几小段，用于要点内部依次浮现 */
export function splitPhrases(text: string) {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const p = nextPhrase(text, i, true)!;
    out.push(p);
    i += p.length;
  }
  return out;
}
