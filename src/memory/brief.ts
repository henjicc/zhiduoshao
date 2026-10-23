import type { MemoryBrief } from "../core/protocol.ts";
import { getMap, listMeta } from "../history/db.ts";
import { dice } from "../lib/match.ts";
import type { MemoryNote } from "../store/types.ts";
import { memoryOn, useMemory } from "./store.ts";

// 把个人记忆用到这次回答上：记忆文本原样交给检索规划（常看的网站会落到元宝的限定站点参数上）和写答案；
// 另外从历史地图里找相似的问题，把结论交给写答案（懂了的不再从头讲）。同时生成卡片上的标注（MemoryNote）。

/** 历史地图里的问题和这次问题的相似度门槛：去掉问句套话后 Dice 系数，且至少共有 3 个二元组（避免只因「PHP」两字就算相关） */
const RECALL = 0.4;
const RECALL_COMMON = 3;
const RECALL_MAX = 2;
/** 问句里的套话：不影响主题，比较前去掉 */
const FILLER = /为什么|怎么样|怎么|如何|什么|哪些|哪个|多少|是不是|有没有|最近|现在|这么|那么|一下|吗|呢|吧|了|的|呀|啊/g;
const core = (q: string) => q.replace(FILLER, "");

/** 之前探索过的相关问题：在历史地图（不含当前这张）的问题里找最像的，取它的结论 */
export async function recall(question: string, mapId: string) {
  const metas = (await listMeta().catch(() => [])).filter((m) => m.id !== mapId);
  const hits = metas
    .map((m) => {
      let best = { q: "", score: 0 };
      for (const q of m.text.split("\n")) {
        const d = dice(core(question), core(q));
        if (d.common >= RECALL_COMMON && d.score > best.score) best = { q, score: d.score };
      }
      return { meta: m, ...best };
    })
    .filter((h) => h.score >= RECALL)
    .sort((a, b) => b.score - a.score)
    .slice(0, RECALL_MAX);
  const out: { mapId: string; title: string; q: string; summary: string }[] = [];
  for (const h of hits) {
    const r = await getMap(h.meta.id).catch(() => undefined);
    const n = r && Object.values(r.nodes).find((x) => x.q === h.q && x.kind === "answer" && x.status === "ready");
    if (n) out.push({ mapId: h.meta.id, title: h.meta.title, q: n.q, summary: n.summary.replace(/\[\d+\]/g, "") });
  }
  return out;
}

/** 记忆文本里写到的网站（域名），回答完成后用来标出检索时真的限定过哪些 */
export const sitesIn = (text: string) => [...new Set(text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [])].map((s) => s.toLowerCase().replace(/^www\./, ""));

/** 这次提问用到的记忆；关闭了记忆、这张地图不用记忆或没有可用的内容时为 null */
export async function buildMemory(question: string, mapId: string): Promise<{ brief: MemoryBrief; note: MemoryNote } | null> {
  if (!memoryOn(mapId)) return null;
  const text = useMemory.getState().text.trim();
  const recalls = await recall(question, mapId);
  if (!text && !recalls.length) return null;

  const brief: MemoryBrief = {};
  if (text) {
    brief.research = `用户的个人记忆（只作参考，和这个问题无关就忽略；里面写的常看网站对口时，可以拿一个查询词限定它）：\n${text}`;
  }
  const answer = [
    text ? `用户的个人记忆（回答偏好照做，其余只作参考）：\n${text}` : "",
    recalls.length ? `用户之前探索过这些相关问题，已经了解的基础不用从头讲，在此基础上往深里答；这些是用户自己的历史，不是来源，不要标角标：\n${recalls.map((r) => `- ${r.q}：${r.summary}`).join("\n")}` : "",
  ].filter(Boolean);
  if (answer.length) brief.answer = answer.join("\n");

  return { brief, note: { sites: sitesIn(text), recalls: recalls.map(({ mapId: m, title, q }) => ({ mapId: m, title, q })) } };
}

/** 回答完成后只保留检索时真的限定过的站点（查询词形如「词 site:域名」） */
export function usedSites(note: MemoryNote, queries: string[]) {
  return note.sites.filter((s) => queries.some((q) => q.endsWith(`site:${s}`) || q.endsWith(`site:www.${s}`)));
}
