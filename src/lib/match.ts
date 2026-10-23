// 引用对回原文：在来源文字里找出与回答中那句话最相关的句子，用于引用气泡里的高亮。
// 纯本地计算（按字的二元组重叠打分），不调用模型；找不到足够相似的句子就不高亮，绝不硬凑。

export interface Passage {
  /** 原文切成的句子，按原顺序 */
  sentences: string[];
  /** 高亮的句子序号（升序），没有找到时为空 */
  hits: number[];
}

/** 低于这个分数视为没有对应原文 */
const MIN_SCORE = 0.22;
/** 相邻句子分数达到最佳的这个比例时一起高亮（论证常跨两句） */
const NEIGHBOR_RATIO = 0.6;

/** 切句：中文句末标点与换行；保留标点在句子末尾 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[。！？；!?;])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 去掉角标、标点和空白，英文转小写，只留下用于比较的字 */
const normalize = (s: string) => s.replace(/\[\d{1,2}\]/g, "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 短文本的相似度：a 的二元组有多少出现在 b 里（以 a 为分母）。用于记忆里比对问题与主题，见 memory/brief.ts */
export function coverage(a: string, b: string): number {
  const x = bigrams(normalize(a));
  if (x.size < 2) return 0;
  const y = bigrams(normalize(b));
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return hit / x.size;
}

/** 两段短文本的相似度（Dice 系数）与共有的二元组数；用于在历史地图里找相似的问题 */
export function dice(a: string, b: string) {
  const x = bigrams(normalize(a)), y = bigrams(normalize(b));
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return { score: x.size + y.size ? (2 * common) / (x.size + y.size) : 0, common };
}

/** 回答里那句话的二元组有多少出现在原文句子里（以回答为分母：原文句子长一些不吃亏） */
function score(quote: Set<string>, sentence: string): number {
  if (!quote.size) return 0;
  const s = bigrams(normalize(sentence));
  let hit = 0;
  for (const g of quote) if (s.has(g)) hit++;
  return hit / quote.size;
}

export function findPassage(source: string, quote: string): Passage {
  const sentences = splitSentences(source);
  const q = bigrams(normalize(quote));
  if (!sentences.length || q.size < 2) return { sentences, hits: [] };
  const scores = sentences.map((s) => score(q, s));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  if (scores[best] < MIN_SCORE) return { sentences, hits: [] };
  const hits = [best];
  for (const n of [best - 1, best + 1]) {
    if (n >= 0 && n < scores.length && scores[n] >= Math.max(MIN_SCORE, scores[best] * NEIGHBOR_RATIO)) hits.push(n);
  }
  return { sentences, hits: hits.sort((a, b) => a - b) };
}

/** 回答文字里某个角标所在的那句话：从角标往前找到上一个句末标点为止 */
export function sentenceBefore(text: string, index: number): string {
  // 去掉紧挨着的其他角标和这句话自己的句末标点，再取上一个句末（含其后的角标）之后的部分
  const before = text.slice(0, index).replace(/(\[\d{1,2}\])+$/, "").replace(/[。！？；!?;]$/, "");
  const parts = before.split(/[。！？；!?;\n](?:\[\d{1,2}\])*/);
  return parts[parts.length - 1].replace(/\[\d{1,2}\]/g, "").trim();
}

/** 一个节点里引用了第 n 条来源的所有句子（结论、要点、详解），去重后按出现顺序 */
export function quotesFor(node: { summary: string; points: { text: string; cites: number[] }[]; detail: string }, n: number): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    const t = q.replace(/[#*]/g, "").replace(/^[-•\d.、\s]+/, "").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const marker = `[${n}]`;
  const each = (text: string) => {
    for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) add(sentenceBefore(text, i));
  };
  each(node.summary);
  for (const p of node.points) if (p.cites.includes(n)) add(p.text);
  for (const line of node.detail.split("\n")) each(line);
  return out;
}
