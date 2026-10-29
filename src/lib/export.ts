import type { Visual } from "../core/protocol.ts";
import type { GNode } from "../store/types.ts";

// 把节点导出为 Markdown：每个节点一节（问题、结论、智能卡片、要点、详解、来源），角标保留为 [n]，对应本节的来源列表。
// 纯函数，保存文件与复制在 export-actions 里。

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
const tableMd = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const cites = (cs: number[]) => cs.map((c) => `[${c}]`).join("");
const withUnit = (n: number, unit: string) => `${n}${unit ? (/^[%％]$|^.$/.test(unit) ? "" : " ") + unit : ""}`;

/** 智能卡片转成表格：图表的数据点也按表格列出，Markdown 里没有图 */
export function visualMd(v: Visual): string {
  const title = v.title ? `**${v.title}**\n\n` : "";
  switch (v.kind) {
    case "table": return title + tableMd([...v.columns, "来源"], v.rows.map((r) => [...r.cells, cites(r.cites)]));
    case "timeline": return title + tableMd(["时间", "经过", "来源"], v.items.map((x) => [x.time, x.text, cites(x.cites)]));
    case "stats": return title + tableMd(["指标", "数值", "来源"], v.items.map((x) => [x.label, x.value, cites(x.cites)]));
    case "bar":
    case "donut": return title + tableMd(["项目", "数值", "来源"], v.items.map((x) => [x.label, withUnit(x.value, v.unit), cites(x.cites)]));
    case "line": return title + tableMd(["时间", "数值", "来源"], v.points.map((p) => [p.x, withUnit(p.y, v.unit), cites(p.cites)]));
  }
}

/** 一个回答节点的一节；level 为标题级别（单独导出用 1，合并导出用 2） */
export function nodeMd(n: GNode, level = 1): string {
  const h = "#".repeat(level);
  const parts = [`${h} ${n.q}`, n.summary.trim()];
  if (n.visual) parts.push(visualMd(n.visual));
  if (n.points.length) parts.push(n.points.map((p) => `- ${p.text}${cites(p.cites)}`).join("\n"));
  // 详解里单独一行的配图标记在纯文本里没有意义
  const detail = n.detailStatus === "ready" ? n.detail.split("\n").filter((l) => !/^\[图\d{1,2}\]$/.test(l.trim())).join("\n").trim() : "";
  if (detail) parts.push(`${h}# 详解\n\n${detail.replace(/^(#{1,4}) /gm, (_, m: string) => `${"#".repeat(Math.min(6, level + 1 + m.length))} `)}`);
  if (n.sources.length) parts.push(`${h}# 来源\n\n${n.sources.map((s, i) => `${i + 1}. ${s.url ? `[${s.title}](${s.url})` : s.title}${s.site ? `（${s.site}）` : ""}`).join("\n")}`);
  return parts.filter(Boolean).join("\n\n");
}

/** 地图里所有回答完成的节点，按树的顺序（先根后子，兄弟按画布上的顺序） */
export function treeOrder(nodes: Record<string, GNode>): GNode[] {
  const out: GNode[] = [];
  const walk = (n: GNode) => {
    if (n.kind === "answer" && n.status === "ready") out.push(n);
    n.children.forEach((c) => nodes[c] && walk(nodes[c]));
  };
  Object.values(nodes).filter((n) => !n.parent).forEach(walk);
  return out;
}

/** 多个节点合并成一份：有标题时作为一级标题，各节点用二级标题 */
export function nodesMd(list: GNode[], title?: string): string {
  if (list.length === 1 && !title) return nodeMd(list[0]) + "\n";
  return [title ? `# ${title}` : "", ...list.map((n) => nodeMd(n, 2))].filter(Boolean).join("\n\n") + "\n";
}

/** 文件名：去掉 Windows 不允许的字符，截短 */
export const fileName = (q: string) => `${q.replace(/[\\/:*?"<>|？]/g, "").trim().slice(0, 40) || "知多少"}.md`;
