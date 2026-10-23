import { create } from "zustand";
import type { Source } from "../core/protocol.ts";

// 引用气泡：点击角标时打开，显示来源与原文里和这句回答相关的句子。同一时间只有一个。

export interface CiteTarget {
  source: Source;
  /** 角标序号（1 起） */
  n: number;
  /** 回答里被引用的那句话，用来在原文里找对应句子 */
  quote: string;
  /** 来源所属的节点；有它时气泡可以「在侧边栏阅读」 */
  nodeId: string | null;
  /** 角标在屏幕上的位置，气泡贴着它放 */
  anchor: { left: number; top: number; right: number; bottom: number };
}

export const useCite = create<{ open: CiteTarget | null }>(() => ({ open: null }));

export const openCite = (t: CiteTarget) => useCite.setState({ open: t });
export const closeCite = () => useCite.setState({ open: null });
