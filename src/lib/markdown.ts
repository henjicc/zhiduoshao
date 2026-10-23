// 模型输出用的 Markdown 子集，逐行解析：标题、段落、无序 / 有序列表，以及单独一行的配图标记 [图n]（见 lib/pics.ts）。
// 模型常用单个换行分隔标题、正文和列表项，所以不能只按空行分块。

export type MdBlock =
  | { type: "h"; level: 1 | 2; text: string }
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "img"; n: number };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FIGURE = /^\[图(\d{1,2})\]$/;
const BULLET = /^[-*•]\s+(.*)$/;
// 「1. 」「1) 」后必须有空格，避免把「1.5 万美元」这类开头当成列表
const ORDERED = /^\d{1,2}(?:[.)）]\s+|、\s*)(.*)$/;

/** 段落里换行续接：中文之间直接相连，英文单词之间补一个空格 */
const joinLine = (a: string, b: string) => (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b);

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  // 正在累积的段落或列表；放在对象里，close() 修改后类型收窄不会过期
  const open: { cur: MdBlock | null } = { cur: null };
  const close = () => { if (open.cur) blocks.push(open.cur); open.cur = null; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const f = FIGURE.exec(line);
    if (f) {
      close();
      blocks.push({ type: "img", n: Number(f[1]) });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      close();
      blocks.push({ type: "h", level: h[1].length === 1 ? 1 : 2, text: h[2].trim() });
      continue;
    }
    const b = BULLET.exec(line) ?? null;
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      const type = b ? "ul" : "ol";
      const item = (b ?? o)![1].trim();
      if (open.cur?.type !== type) { close(); open.cur = { type, items: [] }; }
      (open.cur as Extract<MdBlock, { type: "ul" | "ol" }>).items.push(item);
      continue;
    }
    if (open.cur?.type === "p") open.cur.text = joinLine(open.cur.text, line);
    else { close(); open.cur = { type: "p", text: line }; }
  }
  close();
  return blocks;
}
