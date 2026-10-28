import type { Learned, StreamEvent, Visual } from "./protocol.ts";

// 解析模型按约定行格式输出的答案，边接收边产出事件：
//   标题：...（仅综合节点）
//   结论：...（起点是念头而不是问题时写成「拆题：...」，同样按结论处理，另发一次 framed）
//   数据：{"kind":"table",...}（可选的智能卡片，一行 JSON，见 parseVisual）
//   要点：
//   - 要点 [1][2]
//   追问：
//   [方向] 问题｜先问：理由（只有第一条可以带）
//   [方向] 问题
//   （没有值得再追问的方向时写「追问：无」，发 settled：这条线问透了）

type Mode = "start" | "title" | "summary" | "visual" | "skip" | "points" | "followups";
type Out = Extract<StreamEvent, { type: "title" | "summary" | "framed" | "visual" | "point" | "followup" | "settled" }>;

const CITE = /\[(\d{1,2})\]/g;
const LABEL = /^(标题|结论|拆题|数据|要点|追问)[：:]\s*/;
/** 结论段的两种标签 */
const SUMMARY = new Set(["结论", "拆题"]);
const NONE = /^[（(]?(无|没有|暂无)[)）。.]?$/;
/** 追问后面的「｜先问：理由」 */
const NEXT = /\s*[｜|]\s*先问\s*[：:]\s*(.*)$/;
const NEXT_LABELS = ["数据：", "数据:", "要点：", "要点:", "追问：", "追问:"];

export function extractCites(text: string, max: number) {
  const cites = [...new Set([...text.matchAll(CITE)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= max);
  return { text: text.replace(CITE, "").replace(/\s+([。，；！？])/g, "$1").trim(), cites };
}

/** 智能卡片每种的条数上限：卡片宽度有限，多了挤不下 */
/** 卡片里每项最多保留几个来源角标：空间小，多了挤乱排版 */
const VISUAL_CITES = 3;
const VISUAL_MAX = { columns: 4, rows: 6, timeline: 6, stats: 4, bar: 6, line: 12, donut: 5 };

/** 图表的数值：数字或纯数字字符串（可带千分位逗号）；带文字的不算 */
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?[\d,]*\.?\d+$/.test(v.trim()) ? Number(v.trim().replace(/,/g, "")) : NaN);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * 校验模型写的卡片 JSON。没有来源角标的条目丢掉（卡片里的数字都要能查到出处），
 * 丢完不剩、种类不认识或 JSON 不完整时返回 null。
 */
export function parseVisual(json: string, max: number): Visual | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== "object" || max < 1) return null;
  const v = raw as Record<string, unknown>;
  const title = str(v.title);
  const list = (k: string) => (Array.isArray(v[k]) ? (v[k] as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
  const cites = (x: Record<string, unknown>) =>
    [...new Set((Array.isArray(x.cites) ? x.cites : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= max).slice(0, VISUAL_CITES);
  switch (v.kind) {
    case "table": {
      const columns = (Array.isArray(v.columns) ? v.columns.map(str) : []).slice(0, VISUAL_MAX.columns);
      if (columns.length < 2 || columns.some((c) => !c)) return null;
      const rows = list("rows")
        .map((r) => ({ cells: columns.map((_, i) => str((r.cells as unknown[] | undefined)?.[i])), cites: cites(r) }))
        .filter((r) => r.cites.length && r.cells[0])
        .slice(0, VISUAL_MAX.rows);
      return rows.length >= 2 ? { kind: "table", title, columns, rows } : null;
    }
    case "timeline": {
      const items = list("items")
        .map((x) => ({ time: str(x.time), text: str(x.text), cites: cites(x) }))
        .filter((x) => x.cites.length && x.time && x.text)
        .slice(0, VISUAL_MAX.timeline);
      return items.length >= 2 ? { kind: "timeline", title, items } : null;
    }
    case "stats": {
      const items = list("items")
        .map((x) => ({ label: str(x.label), value: str(x.value), cites: cites(x) }))
        .filter((x) => x.cites.length && x.label && x.value)
        .slice(0, VISUAL_MAX.stats);
      return items.length ? { kind: "stats", title, items } : null;
    }
    case "bar": {
      const items = list("items")
        .map((x) => ({ label: str(x.label), value: num(x.value), cites: cites(x), ...(x.highlight === true ? { highlight: true } : {}) }))
        .filter((x) => x.cites.length && x.label && Number.isFinite(x.value) && x.value >= 0)
        .slice(0, VISUAL_MAX.bar);
      return items.length >= 2 && items.some((x) => x.value > 0) ? { kind: "bar", title, unit: str(v.unit), items } : null;
    }
    case "line": {
      const points = list("points")
        .map((x) => ({ x: str(x.x), y: num(x.y), cites: cites(x) }))
        .filter((x) => x.cites.length && x.x && Number.isFinite(x.y))
        .slice(0, VISUAL_MAX.line);
      return points.length >= 3 ? { kind: "line", title, unit: str(v.unit), points } : null;
    }
    case "donut": {
      const items = list("items")
        .map((x) => ({ label: str(x.label), value: num(x.value), cites: cites(x) }))
        .filter((x) => x.cites.length && x.label && Number.isFinite(x.value) && x.value > 0)
        .slice(0, VISUAL_MAX.donut);
      return items.length >= 2 ? { kind: "donut", title, unit: str(v.unit), items } : null;
    }
    default:
      return null;
  }
}

/** 路径回看每件事最多几个角标、最多几件 */
const LEARNED_CITES = 2;
const LEARNED_MAX = 5;

/**
 * 校验路径回看的「已经弄清的」JSON：{"learned":[{"text":"一句话","cites":[1]}]}。写进文字里的 [n] 也收成角标；
 * 越界的角标丢掉，没有文字的条目丢掉，一条都不剩或 JSON 不完整时返回 null
 */
export function parseLearned(json: string, max: number): Learned[] | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { learned?: unknown }).learned) ? (raw as { learned: unknown[] }).learned : [];
  const items = list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => {
      const t = extractCites(str(x.text), max);
      const cites = [...new Set([...(Array.isArray(x.cites) ? x.cites.map(Number) : []), ...t.cites])].filter((n) => Number.isInteger(n) && n >= 1 && n <= max);
      return { text: t.text, cites: cites.slice(0, LEARNED_CITES) };
    })
    .filter((x) => x.text)
    .slice(0, LEARNED_MAX);
  return items.length ? items : null;
}

/** 去掉越界角标，保留合法的 [n] 供界面渲染 */
function cleanSummary(text: string, max: number) {
  return text.replace(CITE, (m, n) => (Number(n) >= 1 && Number(n) <= max ? m : ""));
}

export class AnswerParser {
  private mode: Mode = "start";
  private line = "";
  /** 当前结论行已经发出的字符数 */
  private sent = 0;
  private title = "";
  /** 卡片 JSON 可能被模型拆成多行，攒到能解析或下一个标签出现为止 */
  private visual = "";
  /** 已经发出的追问条数 */
  private followups = 0;

  constructor(private readonly sourceCount: number) {}

  push(chunk: string): Out[] {
    const out: Out[] = [];
    for (const ch of chunk) {
      if (ch === "\n") {
        this.endLine(out);
      } else {
        this.line += ch;
      }
    }
    this.streamSummary(out, false);
    return out;
  }

  flush(): Out[] {
    const out: Out[] = [];
    this.endLine(out);
    this.visual = "";
    return out;
  }

  private endLine(out: Out[]) {
    this.streamSummary(out, true);
    const raw = this.line.trim();
    this.line = "";
    this.sent = 0;
    if (!raw) return;

    const label = LABEL.exec(raw);
    if (label) {
      const rest = raw.slice(label[0].length);
      if (label[1] === "标题") {
        this.mode = "title";
        if (rest) this.emitTitle(out, rest);
      } else if (SUMMARY.has(label[1])) {
        this.enterSummary(out, label[1]);
        // 结论内容在 streamSummary 中已按增量发出
      } else if (label[1] === "数据") {
        this.mode = "visual";
        this.visual = "";
        this.collectVisual(out, rest);
      } else {
        this.visual = "";
        this.mode = label[1] === "要点" ? "points" : "followups";
        if (rest) this.handleItem(out, rest);
      }
      return;
    }
    // 模型有时漏写「数据：」，直接在结论下一行写卡片 JSON：单独一行以 { 开头的按卡片处理，不当结论
    if (raw.startsWith("{") && (this.mode === "summary" || this.mode === "start")) {
      this.mode = "visual";
      this.visual = "";
      return this.collectVisual(out, raw);
    }
    if (this.mode === "summary") return; // 多行结论：已增量发出
    if (this.mode === "visual") return this.collectVisual(out, raw);
    if (this.mode === "skip") return;
    if (this.mode === "title" && !this.title) return this.emitTitle(out, raw);
    if (this.mode === "start" || this.mode === "title") {
      // 模型漏写「结论：」时，把首段正文当作结论
      this.mode = "summary";
      this.summaryStarted = true;
      out.push({ type: "summary", delta: cleanSummary(raw, this.sourceCount) });
      return;
    }
    this.handleItem(out, raw);
  }

  private collectVisual(out: Out[], text: string) {
    this.visual += text;
    const visual = parseVisual(this.visual, this.sourceCount);
    if (!visual) return;
    out.push({ type: "visual", visual });
    this.visual = "";
    // 一张卡片就够了，之后的行在下一个标签之前都忽略
    this.mode = "skip";
  }

  private emitTitle(out: Out[], text: string) {
    if (this.title) return;
    this.title = text.replace(CITE, "").trim();
    out.push({ type: "title", text: this.title });
  }

  private handleItem(out: Out[], raw: string) {
    if (this.mode === "points") {
      const body = raw.replace(/^([-*•·]|\d+[.、)])\s*/, "");
      const p = extractCites(body, this.sourceCount);
      if (p.text) out.push({ type: "point", point: p });
    } else if (this.mode === "followups") {
      const m = /^[-*•·]?\s*[[【]([^\]】]+)[\]】]\s*(.+)$/.exec(raw);
      const dirRaw = m?.[1].trim() ?? "";
      let q = (m?.[2] ?? raw.replace(/^[-*•·]\s*/, "")).trim();
      // 标签由模型自拟，过长视为不规范，用通用标签兜底
      const dir = dirRaw && dirRaw.length <= 6 ? dirRaw : "延伸";
      // 推荐先问只认第一条；后面的条目也写了就去掉标记，不显示理由
      const next = NEXT.exec(q);
      if (next) q = q.slice(0, next.index).trim();
      const why = next && !this.followups ? next[1].trim() : "";
      // 「追问：无」表示模型认为这条线问透了，不再扩散
      if (!q || NONE.test(q)) {
        if (q && !this.followups && !this.settled) {
          this.settled = true;
          out.push({ type: "settled" });
        }
        return;
      }
      this.followups++;
      out.push({ type: "followup", followup: why ? { dir, q, why } : { dir, q } });
    }
  }

  /** 结论边写边发；行尾可能是未写完的角标，先暂扣 */
  private streamSummary(out: Out[], lineDone: boolean) {
    let text = this.line;
    if (this.mode !== "summary") {
      // 本行以「结论：」开头时切换模式
      const label = LABEL.exec(text.trimStart());
      if (!label || !SUMMARY.has(label[1])) return;
      this.enterSummary(out, label[1]);
      this.line = text = text.trimStart().slice(label[0].length);
      this.sent = 0;
    }
    const t = text.trimStart();
    if (LABEL.test(t) && !SUMMARY.has(t.slice(0, 2))) return;
    // 可能是漏写了「数据：」的卡片 JSON，等这一行写完再判断（见 endLine）
    if (this.sent === 0 && t.startsWith("{")) return;
    // 可能是下一个段落标签的开头（如「要」「要点」），等这一行写完再判断
    if (!lineDone && this.sent === 0 && NEXT_LABELS.some((l) => l.startsWith(t))) return;
    let end = text.length;
    if (!lineDone) {
      const tail = /\[\d{0,2}$/.exec(text);
      if (tail) end = tail.index;
    }
    if (end <= this.sent) return;
    let delta = cleanSummary(text.slice(this.sent, end), this.sourceCount);
    // 多行结论之间补一个空格
    if (this.sent === 0 && this.summaryStarted && delta) delta = " " + delta;
    this.sent = end;
    if (delta) {
      this.summaryStarted = true;
      out.push({ type: "summary", delta });
    }
  }

  private summaryStarted = false;
  private framed = false;
  private settled = false;

  private enterSummary(out: Out[], label: string) {
    this.mode = "summary";
    if (label !== "拆题" || this.framed) return;
    this.framed = true;
    out.push({ type: "framed" });
  }
}
