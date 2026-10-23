import type { Source } from "../core/protocol.ts";

// 详解里可以穿插的配图：来源配图先按元宝给的描述（caption）去掉没有信息量的，再编号交给写详解的模型挑选。
// 详解正文里的 [图n] 指这里的序号；同一组来源算出的序号固定，详解随存档保存后仍能对上。

export interface Pic { n: number; url: string; caption: string; source: number; site: string }

/** 网站截图、标志、图标、广告、头像这类图对理解问题没有帮助 */
const JUNK = /截图|截屏|网页|页面|界面|网站|官网|首页|主页|logo|标志|标识|图标|徽标|二维码|广告|横幅|banner|头像|按钮|水印|装饰|封面|宣传海报|海报/i;
const MIN_CAPTION = 4;
export const MAX_CANDIDATES = 8;

export function candidatePics(sources: Source[]): Pic[] {
  const out: Pic[] = [];
  const seen = new Set<string>();
  // 先每个来源取一张，再取第二张，避免全被同一篇文章占满
  for (let round = 0; round < 2 && out.length < MAX_CANDIDATES; round++) {
    sources.forEach((s, i) => {
      const good = (s.pics ?? []).filter((p) => p.caption.length >= MIN_CAPTION && !JUNK.test(p.caption));
      const p = good[round];
      if (!p || out.length >= MAX_CANDIDATES) return;
      const key = p.caption.trim();
      if (seen.has(p.url) || seen.has(key)) return;
      seen.add(p.url);
      seen.add(key);
      out.push({ n: out.length + 1, url: p.url, caption: key, source: i + 1, site: s.site });
    });
  }
  return out;
}
