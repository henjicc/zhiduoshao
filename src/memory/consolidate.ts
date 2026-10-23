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
}

export function consolidatePrompt(text: string, usage: Usage): ChatMessage[] {
  const asks = usage.pending.map((s, i) => `${i + 1}. ${s.kind === "detail" ? "（打开详解深入阅读）" : ""}${s.q}`).join("\n");
  return [
    {
      role: "system",
      content: `你在${MEMORY_MARK}。这段记忆会在用户每次提问时交给检索和回答的模型，帮它们更懂这个用户；用户也会直接阅读和修改它。
根据近期的使用情况更新记忆，输出更新后的完整记忆文本，不要别的话：
- 每行一条，以「- 」开头，短句，总共不超过 ${MEMORY_MAX} 字，通常 3 到 8 条。
- 写用户长期关注的领域（用 4 到 12 字概括，如“家用网络设备”“PHP 安全”，至少两次相关提问才写）、常看的网站（检索时可以优先限定）、喜欢的追问角度、回答偏好。
- 现有记忆里的内容优先保留，尤其是用户自己写的偏好，不要删改；只补充新发现、更新已过时的说法、合并重复。
- 一次性的好奇、随口一问不要写；不要写健康、财务、身份等个人隐私；不要编造使用情况里没有的东西。
- 没有值得更新的内容就原样输出现有记忆。`,
    },
    {
      role: "user",
      content: [
        `现有记忆：\n${text.trim() || "（空）"}`,
        `近期提问：\n${asks || "（无）"}`,
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
