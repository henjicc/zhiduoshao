import type { ChatMessage } from "../core/providers/types.ts";
import { MEMORY_MAX, type Signal } from "./store.ts";

// 整理记忆：攒够几次提问后，由快速模型把近期的使用信号合进那段记忆文本，输出整段新文本。
// 用户手写的内容优先：模型只补充、更新，不删改用户明确写下的偏好；记不准的、一次性的不写。

export const MEMORY_MARK = "维护用户的个人记忆";
/** 攒够几次提问整理一次 */
export const CONSOLIDATE_AT = 4;

export interface Usage {
  pending: Signal[];
  sites: { site: string; count: number }[];
  angles: { dir: string; rate: number }[];
  /** 最近探索过的地图，一张地图是一次独立的探索；判断一个领域是不是反复关注要看它出现在几张地图里 */
  maps: { id: string; title: string }[];
}

/**
 * 近期提问按地图分组、以地图标题为组名：同一张地图里多是顺着延伸问题追下去的，平铺成一列时一次探索就会被当成「多次相关提问」；
 * 组名不写标题时，模型对不上「其他地图」里的同一张，又会把它算成两张。刚建、还没保存的地图没有标题
 */
function groupAsks(pending: Signal[], titles: Map<string, string>) {
  const groups = new Map<string, Signal[]>();
  for (const s of pending) groups.set(s.mapId, [...(groups.get(s.mapId) ?? []), s]);
  return [...groups].map(([id, g]) => `${titles.has(id) ? `地图「${titles.get(id)}」` : "一张新地图"}：\n${g.map((s) => `- ${s.kind === "detail" ? "（打开详解深入阅读）" : ""}${s.q}`).join("\n")}`).join("\n");
}

export function consolidatePrompt(text: string, usage: Usage): ChatMessage[] {
  const titles = new Map(usage.maps.map((m) => [m.id, m.title]));
  const asked = new Set(usage.pending.map((s) => s.mapId));
  const others = usage.maps.filter((m) => !asked.has(m.id)).map((m) => m.title);
  return [
    {
      role: "system",
      content: `你在${MEMORY_MARK}。这段记忆会在用户每次提问时交给检索和回答的模型，帮它们更懂这个用户；用户也会直接阅读和修改它。
根据近期的使用情况更新记忆，输出更新后的完整记忆文本，不要别的话：
- 每行一条，以「- 」开头，短句，总共不超过 ${MEMORY_MAX} 字，通常 3 到 8 条。
- 写用户长期关注的领域（用 4 到 12 字概括，如“家用网络设备”“PHP 安全”）、常看的网站（检索时可以优先限定）、喜欢的追问角度、回答偏好。
- 一个领域至少在两张不同的地图里出现过（近期提问的每一组是一张地图，「其他最近探索过的地图」是另外的地图）才算长期关注；同一张地图里顺着追问下去的问题只算一次探索。
- 使用情况只能写成事实（如“常点对比类追问”“常打开详解”），不要改写成对回答的要求（如“回答时要主动做对比”）；对回答的要求只保留现有记忆里已有的。
- 现有记忆里的内容优先保留，尤其是用户自己写的偏好，不要删改；只补充新发现、更新已过时的说法、合并重复。
- 一次性的好奇、随口一问不要写；不要写健康、财务、身份等个人隐私；不要编造使用情况里没有的东西。
- 没有值得更新的内容就原样输出现有记忆。`,
    },
    {
      role: "user",
      content: [
        `现有记忆：\n${text.trim() || "（空）"}`,
        `近期提问（按地图分组）：\n${groupAsks(usage.pending, titles) || "（无）"}`,
        others.length ? `其他最近探索过的地图（每行一张）：\n${others.join("\n")}` : "",
        usage.sites.length ? `常点开的来源网站：${usage.sites.map((s) => `${s.site}（${s.count} 次）`).join("、")}` : "",
        usage.angles.length ? `常点的延伸问题角度：${usage.angles.map((a) => `${a.dir}（点击率 ${Math.round(a.rate * 100)}%）`).join("、")}` : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

/** 模型输出的新记忆：去掉代码块围栏与多余空行，截到上限；空输出视为失败（不能把记忆清空） */
export function parseMemory(raw: string): string | null {
  const t = raw.replace(/^```\w*\n?|\n?```$/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).join("\n").trim();
  return t ? t.slice(0, MEMORY_MAX) : null;
}
