import type { Source } from "../protocol.ts";

// 示例供应商使用的虚构内容：一个写好的完整话题 + 其他问题的通用模板。
// 只用于在没有密钥时评估界面与交互，不代表真实信息。

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** 内存涨价话题的固定来源，答案中的 [n] 按此顺序引用 */
export const MEMORY_SOURCES = (): Source[] => [
  { id: "m1", site: "财经观察", title: "存储芯片合约价连续第三个季度上调", url: "https://example.com/mock/m1", date: day(2), snippet: "多家机构数据显示，DRAM 合约价本季度继续上调，涨幅较上季度有所扩大。" },
  { id: "m2", site: "存储前线", title: "原厂产能加速向 HBM 倾斜，通用 DRAM 供给收紧", url: "https://example.com/mock/m2", date: day(3), snippet: "主要原厂将更多先进制程产线转向高带宽内存，通用内存投片量下降。" },
  { id: "m3", site: "产业研究院", title: "全球 DRAM 市场季度追踪报告", url: "https://example.com/mock/m3", date: day(8), snippet: "报告指出 HBM 单位容量的晶圆消耗约为 DDR5 的 2.5 至 3 倍。" },
  { id: "m4", site: "数码评测", title: "DDR4 停产倒计时：旧平台用户该不该囤内存", url: "https://example.com/mock/m4", date: day(5), snippet: "随着 DDR4 逐步停产，旧平台补货需求集中释放，现货价格波动加剧。" },
  { id: "m5", site: "市场周报", title: "电脑配件零售价格周度监测", url: "https://example.com/mock/m5", date: day(1), snippet: "内存条零售价连续四周上涨，涨幅滞后于合约价。" },
  { id: "m6", site: "供应链日报", title: "渠道库存降至近两年低位", url: "https://example.com/mock/m6", date: day(4), snippet: "经历去年的减产去库存后，渠道库存周转天数已低于正常水平。" },
  { id: "m7", site: "技术百科", title: "高带宽内存的结构与制造难点", url: "https://example.com/mock/m7", date: day(21), snippet: "HBM 由多层 DRAM 芯片通过硅通孔垂直堆叠，良率控制难度高。" },
];

export const isMemoryTopic = (q: string) => /内存|HBM|DRAM|DDR|存储|原厂|晶圆|TSV/i.test(q);

/** 写好的答案：键为问题原文 */
export const MEMORY_ANSWERS: Record<string, string> = {
  "为什么最近内存条突然涨价了？": `结论：AI 服务器对高带宽内存（HBM）的需求挤占了原厂产能，叠加去年减产后库存回落，消费级内存供给收紧，价格在两个季度内明显回升。[2][6]
数据：{"kind":"line","title":"DRAM 合约价指数","unit":"点","points":[{"x":"去年Q3","y":100,"cites":[1]},{"x":"去年Q4","y":96,"cites":[1]},{"x":"今年Q1","y":104,"cites":[1]},{"x":"今年Q2","y":118,"cites":[1,3]},{"x":"今年Q3","y":131,"cites":[1]}]}
要点：
- 主要原厂把更多产线转向 HBM，同样一片晶圆产出的容量远低于普通 DRAM。[2][3]
- 去年行业主动减产去库存，渠道库存已降至近两年低位。[6]
- DDR4 逐步停产，旧平台用户集中补货，推高现货价格。[4]
- 合约价连续上调，零售价通常滞后 1 到 2 个月跟涨。[1][5]
追问：
[为什么] 为什么 HBM 会挤占普通内存的产能？
[进展] 这轮涨价还会持续多久？
[相关方] 哪些厂商从这轮涨价中受益最多？
[争议] 这是真实缺货，还是厂商在控制供给？
[延伸] HBM 和普通 DDR5 有什么区别？`,
  "为什么 HBM 会挤占普通内存的产能？": `结论：HBM 要把多层 DRAM 芯片堆叠封装，良率更低、单位容量占用的晶圆面积约为普通内存的三倍，原厂每多产一份 HBM，就要少产几份通用内存。[3][7]
数据：{"kind":"bar","title":"同等容量的晶圆消耗","unit":"倍","items":[{"label":"DDR5","value":1,"cites":[3]},{"label":"LPDDR5","value":1.1,"cites":[3]},{"label":"HBM3E","value":3,"cites":[3,7],"highlight":true}]}
要点：
- HBM 由 8 到 12 层 DRAM 芯片垂直堆叠，任何一层失效都会导致整颗报废。[7]
- 同等容量下，HBM 消耗的晶圆面积约为 DDR5 的 2.5 到 3 倍。[3]
- HBM 单价和利润率远高于通用内存，原厂优先保障其产能。[2]
追问：
[进展] 原厂今年有扩产计划吗？
[延伸] 什么是 TSV 硅通孔技术？
[争议] HBM 需求会不会只是短期泡沫？`,
  "这轮涨价还会持续多久？": `结论：多数机构预计涨势会延续到明年上半年，之后取决于新产能投放节奏和 AI 服务器出货是否放缓。[1][3]
数据：{"kind":"timeline","title":"价格走势回顾","items":[{"time":"去年","text":"原厂主动减产，消化库存","cites":[6]},{"time":"今年上半年","text":"产能转向 HBM，合约价开始上调","cites":[2]},{"time":"本季度","text":"合约价连续第三个季度上调","cites":[1]},{"time":"近四周","text":"零售价跟涨","cites":[5]}]}
要点：
- 新建晶圆厂从动工到量产通常需要两年以上，短期难以补足缺口。[3]
- 部分机构认为下季度合约价涨幅将收窄，但仍为正增长。[1]
- 若 AI 服务器订单放缓，HBM 产能可能回流通用内存，价格会较快回落。[2]
追问：
[相关方] 哪些新产能会在明年投产？
[延伸] 普通消费者现在该买内存吗？
[争议] 价格回落的信号会是什么？`,
  "哪些厂商从这轮涨价中受益最多？": `结论：掌握 HBM 量产能力的头部原厂受益最明显，其次是有库存的模组厂和渠道商；整机厂商则承受成本压力。[2][6]
数据：{"kind":"table","title":"谁受益、谁承压","columns":["角色","处境","原因"],"rows":[{"cells":["头部原厂","受益最多","掌握 HBM 产能"],"cites":[2,3]},{"cells":["模组厂","阶段受益","手里有库存"],"cites":[6]},{"cells":["整机厂商","成本承压","内存占成本上升"],"cites":[5]}]}
要点：
- HBM 供应集中在少数几家原厂，议价能力强。[2][3]
- 提前备货的模组厂在涨价周期中获得库存收益。[6]
- 整机和手机厂商需要在涨价与降低配置之间取舍。[5]
追问：
[争议] 整机会因此涨价吗？
[进展] 国内存储厂商的进展如何？`,
  "这是真实缺货，还是厂商在控制供给？": `结论：两种因素都有：HBM 挤占产能是真实约束，但原厂在减产后放缓了恢复节奏，客观上也撑住了价格。[2][6]
数据：{"kind":"donut","title":"HBM 供应份额","unit":"%","items":[{"label":"原厂 A","value":52,"cites":[2]},{"label":"原厂 B","value":36,"cites":[2]},{"label":"原厂 C","value":12,"cites":[3]}]}
要点：
- 渠道库存周转天数已低于正常区间，说明供给确实收紧。[6]
- 原厂资本开支向 HBM 集中，通用产线扩产意愿较低。[2]
- 有分析认为原厂吸取了上一轮价格崩跌的教训，倾向谨慎扩产。[1]
追问：
[延伸] 存储行业为什么总是暴涨暴跌？
[相关方] 监管机构会介入价格吗？`,
  "HBM 和普通 DDR5 有什么区别？": `结论：HBM 用芯片堆叠和超宽总线换取极高带宽，主要服务 AI 加速卡；DDR5 是插在主板上的通用内存，更便宜、容量更灵活。[7][4]
数据：{"kind":"stats","title":"HBM 与 DDR5 的差距","items":[{"label":"HBM 晶圆消耗","value":"约 3 倍","cites":[3]},{"label":"单堆栈带宽","value":"10 倍以上","cites":[7]},{"label":"堆叠层数","value":"8–12 层","cites":[7]}]}
要点：
- HBM 单个堆栈的带宽可达一条 DDR5 的十倍以上。[7]
- HBM 与 GPU 封装在一起，不能单独更换或升级。[7]
- DDR5 面向电脑和服务器通用场景，每 GB 成本远低于 HBM。[4]
追问：
[延伸] 什么是 TSV 硅通孔技术？
[进展] 下一代 HBM 有什么变化？`,
};

const GENERIC_SITES = ["观察者周刊", "行业研究院", "科技日志", "数据前哨", "百科词条", "深度评论", "政策速递", "市场快报"];
const GENERIC_TITLES = ["一文读懂来龙去脉", "最新进展与关键数据", "专家怎么看", "背后的三个原因", "常见误区梳理", "相关政策解读", "行业影响分析", "时间线回顾"];

/** 从问句里取出话题词，用于生成不重复整句的示例内容 */
export function topicOf(q: string) {
  const t = q
    .replace(/[？?。！!]+$/, "")
    .replace(/^(为什么|为何|怎么|如何|怎样|什么是|有哪些|哪些|是否|请问)/, "")
    .replace(/(是什么|有什么|怎么样|吗|呢|了|么)$/, "")
    .trim();
  return t.length > 14 ? t.slice(0, 14) : t || q.slice(0, 14);
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

/** 示例配图：纯色 SVG，不依赖外部网络 */
const mockPic = (hue: number, caption: string) => ({
  url: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="hsl(${hue} 30% 55%)"/></svg>`)}`,
  caption,
});

export function genericSources(query: string): Source[] {
  const topic = topicOf(query);
  const h = hash(query);
  const web: Source[] = Array.from({ length: 6 }, (_, i) => {
    const site = GENERIC_SITES[(h + i) % GENERIC_SITES.length];
    return {
      id: `g-${h}-${i}`,
      site,
      title: `${topic}：${GENERIC_TITLES[(h + i * 3) % GENERIC_TITLES.length]}`,
      url: `https://example.com/mock/${h}/${i}`,
      date: day(((h >> i) % 40) + i),
      snippet: `关于${topic}的公开资料摘要（示例内容）。`,
      // 模拟元宝的权威度、配图与子链
      ...(i === 0 ? { authority: 5, links: [{ title: `${topic}统计公报（PDF）`, url: `https://example.com/mock/${h}/0.pdf` }] } : {}),
      // 第一张模拟没有信息量的网站截图，应被过滤
      ...(i < 3 ? { pics: [mockPic((h + i * 60) % 360, i === 0 ? `${GENERIC_SITES[(h + i) % GENERIC_SITES.length]}网站首页截图` : `${topic}示意图 ${i + 1}`), mockPic((h + i * 60 + 30) % 360, `${topic}数据图 ${i + 1}`)] } : {}),
    };
  });
  // 模拟一条没有链接的权威卡片（VR 卡）
  return [{ id: `card:${topic}`, site: "权威信源", title: `${topic}：权威数据卡片`, url: "", card: true, snippet: `${topic}的权威摘要（示例内容）：关键指标与最新口径。` }, ...web];
}

const LEADS = [
  (t: string) => `${t}主要受供需关系、政策方向和技术成熟度三方面影响，目前各方共识是短期变化有限、长期趋势明确。`,
  (t: string) => `围绕${t}，现有资料给出的答案比较一致：关键在于成本能否继续下降，以及规模化应用何时落地。`,
  (t: string) => `${t}并不是单一原因造成的，背景、参与方的利益和最新数据共同决定了现在的局面。`,
];

const POINTS = [
  (t: string) => `多份资料显示，${t}的核心变量是成本与规模。`,
  () => "近一年的数据出现明显变化，但不同口径的统计结果有差异。",
  () => "主要参与方的立场不同，公开表态和实际动作并不完全一致。",
  () => "短期内的影响有限，更大的变化可能出现在两到三年后。",
  () => "部分说法缺少原始数据支撑，需要谨慎看待。",
];

const FOLLOWS: [string, (t: string) => string][] = [
  ["为什么", (t) => `${t}的根本原因是什么？`],
  ["进展", () => "最近一年有哪些关键变化？"],
  ["相关方", () => "哪些机构在推动这件事？"],
  ["争议", () => "反对的声音主要在说什么？"],
  ["延伸", () => "需要先弄清楚哪些基础概念？"],
];

/** 通用答案：话题词代入模板，按问题哈希挑选，保证同一问题结果稳定 */
export function genericAnswer(q: string, cite: boolean) {
  const t = topicOf(q);
  const h = hash(q);
  const c = (s: string) => (cite ? s : "");
  const points = [0, 1, 2, 3, 4].filter((i) => (h >> i) % 5 !== 0).slice(0, 4).map((i) => `- ${POINTS[i](t)}${c(`[${(i % 6) + 1}]`)}`);
  const follows = FOLLOWS.filter((_, i) => i === 0 || (h >> (i + 2)) % 4 !== 0).slice(0, 4).map(([d, f]) => `[${d}] ${f(t)}`);
  return [`结论：${LEADS[h % LEADS.length](t)}${c("[1][2]")}`, "要点：", ...points, "追问：", ...follows].join("\n");
}
