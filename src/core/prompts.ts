import type { MemoryBrief, NodeContext, OpKind, Prefs, Source } from "./protocol.ts";
import type { Pic } from "../lib/pics.ts";
import type { ChatMessage } from "./providers/types.ts";

// 提示词约定：稳定的规则放 system，本次的材料放 user，问题放在 user 最后。
// 输出格式由 format.ts 解析，改格式必须同步解析器与测试。

// 用户本地日期（toISOString 是 UTC，北京时间 0–8 点会差一天）
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 思考模型会在思维链里反复核对格式，明确告诉它不必这样做 */
const THINK = `思考保持简短：判断哪些结论有来源支撑、各引用哪条，哪些部分要靠自身知识补充。格式已在下方给出示例，不要在思考中复述规则。`;

/**
 * 智能卡片：可选的「数据：」一行 JSON，由 format.ts 的 parseVisual 校验。只在有搜索结果时提供，
 * 卡片里的数据必须来自来源，没有角标的条目会被丢掉。
 */
const VISUAL_RULE = `数据：可选的可视化卡片。只在搜索结果里有能直接回答这个问题的数据时写：图表展示的必须正是用户问的那件事（问为什么涨价，就画成本涨了多少；问要等多久，就画价格走势），同一话题下的背景数据（别的地区、别的人群、别的品类、后果和影响）不画；没有这样的数据就整行不写，拿不准也不写，不要硬凑；数据必须来自搜索结果，每一项都标来源序号。按数据的用途选一种，能用数字图表（柱状、折线、环形、关键数字）就不要用表格：
- 几项同一指标的数值比较（性能、价格、份额以外的大小对比）：{"kind":"bar","title":"标题","unit":"分","items":[{"label":"A","value":86,"cites":[1]},{"label":"B","value":72,"cites":[2],"highlight":true}]}，2 到 6 项，value 只写数字，单位放 unit；问题关心的那一项标 highlight。
- 一个指标随时间的变化（价格走势、用户数增长）：{"kind":"line","title":"标题","unit":"元","points":[{"x":"1月","y":899,"cites":[1]}]}，3 到 12 个点，按时间先后排。
- 整体的构成（市场份额、占比）：{"kind":"donut","title":"标题","unit":"%","items":[{"label":"A","value":45,"cites":[1]}]}，2 到 5 项。
- 三样以上的东西按几项指标对照、值大多是文字（型号参数清单、方案对比）：{"kind":"table","title":"标题","columns":["型号","端口","速率"],"rows":[{"cells":["A","8 口","2.5G"],"cites":[1]}]}，2 到 4 列、2 到 6 行，第一列是被比较的对象，单元格不超过 12 字。
- 有明确经过的事件（新闻事件、安全漏洞、发布会、政策变化）：{"kind":"timeline","title":"标题","items":[{"time":"10月20日","text":"发生了什么","cites":[2]}]}，2 到 6 条，每条不超过 30 字。
- 一到四个关键数字（评分、价格、规模、日期），或两样东西之间各项的提升幅度（问“提升多少”“差多少”时用它，如 CPU +20%）：{"kind":"stats","title":"标题","items":[{"label":"指标","value":"9.2","cites":[3]}]}，数值带单位，不超过 10 字。
每一项只标一到两个最直接的来源序号。柱状、环形和表格里并排比较的各项要是同一时期、同一口径的数据，不要把多年前的旧型号当成现在的对手和新型号并排比；随时间的变化用折线。标题不超过 16 字。这一行放在结论下面，必须以「数据：」开头，后面接整段写成一行的 JSON；要点不要重复这里已经列出的数据。`;

/**
 * 卡片结论与要点的长度只在这里定，风格（styleRule）与读者判断（READER_RULE）不写长度：几处都写时说法容易矛盾，模型会按最后读到的那条写。
 * 简洁明了、详细深入各有一套；其他风格按问题决定。
 * 只限句数和条数不够：DeepSeek 的一句话比混元长四到六成，爱用冒号、分号把几层意思塞进一句、把来源里的名字全列出来，
 * 所以另给字数参考，并用 SHORT 约束句式
 */
const SHORT = "每句只讲一层意思，不要用冒号、分号或一长串并列把几件事塞进一句；列举时挑两三个最有代表性的，不要把来源里的名字、型号、版本号全列出来。";
const LENGTH = {
  auto: {
    summary: "长度按问题需要：单一事实一两句、50 字以内；需要理解的问题写成一段完整、好懂的解释，两到四句、整段 80 到 150 字：先用大白话说清它是什么、怎么回事，必要时打个比方，最后一句带出它现在的状态。要简洁，但信息量要足，不要为了短而省掉关键信息。" + SHORT,
    points: "按需要写 2 到 6 条，每条是结论之外的一个补充知识点：一到两句，讲清一件具体的事（例子、数据、原理、区别或注意事项），每条 25 到 60 字，不要只写一个短语，也不要重复结论说过的话；单一事实（某个数字、日期、是否）写 2 到 3 条，需要理解的问题多写。",
  },
  concise: {
    summary: "一到两句、60 字以内，只说答案本身，不展开原因和背景。" + SHORT,
    points: "写 2 到 4 条，每条一句、30 字以内，只留最关键的补充，不要重复结论说过的话。",
  },
  deep: {
    summary: "写成一段完整的解释，三到五句：说清它是什么、为什么会这样、现在怎样，必要时打个比方。",
    points: "写 4 到 6 条，每条两到三句，讲清一件具体的事，带上数据、原理或适用条件，不要重复结论说过的话。",
  },
};

/** reader：带了 READER_RULE（按读者判断详略）时，按问题决定长度的风格给入门读者多写几条 */
const format = (visual: boolean, style: Prefs["style"] | undefined, reader: boolean) => {
  const len = style === "concise" || style === "deep" ? LENGTH[style] : LENGTH.auto;
  const forBeginner = reader && len === LENGTH.auto ? "按入门读者答时写 4 到 6 条，单一事实仍写 2 到 3 条。" : "";
  return `按下面的纯文本格式输出，不要 Markdown，不要多余的话：
结论：第一句就是精准的答案本身——具体的结论、数字、日期、是或否、该怎么做，不铺垫、不复述问题。${len.summary}用户一句话里问了几个问题时，按提问的顺序逐个回答，每个问题一句、都要答到，这时句数可以按问题数放宽。结论里少用术语，非用不可的顺手解释；排名、参数、价格、百分比这类数字不放结论，放进要点或数据卡片；不要用“到某年某月”“截至目前”开头。${visual ? "\n" + VISUAL_RULE : ""}
要点：
- ${len.points}${forBeginner}写每条要点前先对照用户问的事：这条回答或支撑的是哪一问（原因、依据、该怎么做、要多久）？对不上的就不写，宁可少写一条；同一话题下的后果、行业影响、别处或别的人群的情况都算对不上。更系统的展开留给详情页。
追问：
[角度] 具体问句｜先问：理由
[角度] 具体问句
每条问句不超过 22 字。数量由你按这个问题真正值得继续追问的方向决定，最多 6 条，宁少勿滥，不要凑数。第一条放离解开起点的疑问最近的那一步（起点拆成了几件事时，是还没有专门问过的下一件），问句后面接「｜先问：」和半句理由（不超过 14 字，说清为什么先问它），只有第一条这样写。
写追问前先对照起点（探索路径的第一层，没有路径时就是这个问题）：起点那句话里的疑问到这一层是不是已经有了明确的答案，对方已经能做决定或已经弄懂？起点拆成了几件事时，要每件事都有一层专门答过，只算探索路径上的各层和这一层：在别的回答里顺带提到的不算，“已有问题”只是列在地图上、不代表答过；还有没答过的，第一条就结合这一层的结论把它问得更具体。都答过了，再往下只剩操作细节、参数和旁支知识，这一段只写「追问：无」，不要为了延续而硬找方向。
角度是 2 到 4 字的标签，按方向自拟（如原因、影响、对比、成本、风险、历史、替代方案），各条角度尽量不同；“已有问题”是地图上已经列出的，不要重复或同义；接着解开起点的第一条除外，它可以和已有问题相近，但要结合这一层的结论问得更具体。

示例（只示意格式，内容与本题无关）：
结论：主要因为原厂把产能转向 AI 服务器用的高带宽内存，普通内存供给变少。[1][3]
要点：
- 高带宽内存占用的晶圆面积约为普通内存的 3 倍。[2]
- 渠道库存已降到近两年低位。[4]
- 零售价通常比合约价晚 1 到 2 个月上涨。[1]
追问：
[为什么] 为什么原厂更愿意生产高带宽内存？｜先问：涨价的根子在这里
[走势] 这轮涨价还会持续多久？
[真伪] 这是真实缺货还是厂商在控制供给？`;
};

/**
 * 模糊起点：首页输入的常常不是问题，而是一个念头、情绪或处境（如「手机卡了想换，但今年都涨价了，现在买总觉得亏」）。
 * 这时不急着给建议，先拆开：说清对方其实在决定哪几件事，只列可查证的事实，给几个方向让对方顺着走。
 * 只加在探索的第一层（不是「看看新进展」）；能直接回答的问题照常回答。卡片长度的条数在 LENGTH，这里只管拆题这一种写法
 */
export const FRAME_MARK = "念头、情绪或处境";
const frameRule = (search: boolean) => `起点：这是探索的第一层。先判断用户输入的是一个能直接回答的问题，还是一个${FRAME_MARK}（比如纠结要不要做某事、担心、后悔、觉得亏）。
- 能直接回答的问题，哪怕问得很短、很口语，照常按上面的格式回答。
- 是念头、情绪或处境时，不急着下结论或给建议，先把它拆开，改用下面的写法，不按上面的条数：
拆题：一句话说清对方其实在决定哪几件事，不超过 40 字。
要点：
- 0 到 2 条，只写里面可以查证的事实（比如价格今年涨了多少）${search ? "，带来源序号" : ""}；没有这样的事实就不写。
追问：
3 到 5 个方向，按上面追问的写法，第一条带「｜先问：」。
拆题时不写「数据：」。`;

const CITE_RULE = `以搜索结果为主要依据，句末用 [序号] 标注来源（可多个）。
- 搜索结果没覆盖到的部分，尤其是常识、方法建议、一般原理这类问题，可以用你自己的知识补充，直接给出有用的回答；这些句子不标 [序号]，也不要冒充来源。
- 具体数据、日期、人名机构、最新动态只用来源里的，不要编造；来源之间有冲突就如实说明。
- 来源可信度不一：官方、原始出处和主流媒体优先；只有一个不知名网站给出的具体数字，不放进结论和数据卡片。
- 不要写“材料未提及”“资料没有给出”这类话，直接回答用户的问题。
- 来源下的「配图」是搜索服务对文中图片的文字描述，属于该来源的内容，可以同样引用它的序号；追问也可以从配图和来源里提到但没展开的线索找方向。`;

/**
 * 按提问方式判断对方懂多少：问得越短越基础（「PHP 是啥」），越说明对方完全不了解，反而要答得更完整、更好懂；
 * 问题里已经带着术语、条件或对比，说明对方懂行，直接给精准答案。用户自定义了回答风格时以用户为准，不加这条
 */
export const READER_RULE = `先从提问方式判断对方懂多少，再决定答多细：
- 问题很短、很基础，没有任何限定或背景（如“X 是啥”“什么是 X”“X 有什么用”），说明对方几乎不了解这个领域，按入门读者来答：用大白话先说清它是什么、拿来做什么，要点里带一个具体例子；术语第一次出现时顺手用半句话解释；追问优先给入门路径上的下一步（怎么上手、和相近概念的区别、常见用途）。
- 问题里已经带着专业术语、具体条件、版本或对比，说明对方懂行：直接给精准答案，不解释基础概念。`;

/** 用户选的回答风格的措辞要求，回答、综合与详解共用；卡片长度在 LENGTH。默认的自动不额外要求 */
export function styleRule(prefs?: Prefs) {
  switch (prefs?.style) {
    case "concise": return "\n回答风格：简洁明了，只留最关键的信息。";
    case "plain": return "\n回答风格：通俗易懂。少用术语，必须用到的术语顺手用一句大白话解释，可以打比方；格式不变。";
    case "deep": return "\n回答风格：详细深入，多给具体数据、原理和适用条件。";
    case "custom": return prefs.customStyle.trim() ? `\n用户希望的回答风格：${prefs.customStyle.trim().slice(0, 100)}（只影响措辞与详略，格式不变）` : "";
    default: return "";
  }
}

/** 不联网时模型会把知识截止之后出现的东西说成「不存在」：没听说过只能说明知识里没有 */
const NO_SEARCH_RULE = `本次没有联网搜索，基于自身知识回答，不要标注 [序号]；不确定的地方要说明。你没听说过的产品、事件或说法，可能出现在你的知识之后，不要断言它不存在，直接说你的知识里没有相关信息、建议联网再查。`;

/**
 * 时效：只给日期不够，模型会把来源里几年前的数据当现状、把自己训练时的知识当最新。
 * 要求以最新来源为准，变化快的领域说到现状时落在今天，但不规定要讲多少现状（写成「讲清发展到哪一步、主要变化」时卡片会被撑长）；有追问时留一个指向当前前沿的方向（写成「至少一条」时模型几乎写不出「追问：无」）
 */
const timeRule = (search: boolean, followups = true) => `时效：今天是 ${today()}，你自己的知识可能落后于今天。
- ${search ? "同一件事来源有新有旧时，以发布时间最新的为准；数据、例子和“目前”“最新”的说法优先用最近的来源，只有旧资料时写明“截至某年”。" : "涉及最新情况、数据或产品时，说明你的知识可能已经过时。"}
- 发展快的领域（AI、科技产品、互联网、政策、市场行情等），回答要落在今天：说到现状时以最新情况为准，不要把几年前的情况当成现状；现状用大白话自然地带出来，不要为了显得新而堆排名、参数、百分比。${followups ? "\n- 有追问时，至少一条指向这个话题当前的前沿或最新趋势；变化不快的领域不必。" : ""}`;

/** 每个来源带给模型的配图描述：最多几条、每条最多几个字 */
const CAPTIONS_PER_SOURCE = 4;
const CAPTION_LEN = 40;

/** 元宝对文中配图的描述（caption）：去重、截短，让模型知道图片里有什么；没有时为空 */
export function captionLine(s: Source) {
  const seen = new Set<string>();
  for (const p of s.pics ?? []) {
    const c = p.caption.trim().slice(0, CAPTION_LEN);
    if (c) seen.add(c);
    if (seen.size >= CAPTIONS_PER_SOURCE) break;
  }
  return seen.size ? `\n配图：${[...seen].join("；")}` : "";
}

export function formatSources(sources: Source[]) {
  return sources
    .map((s, i) => {
      const tags = [s.site, s.date, s.card ? "权威信源" : "", s.authority !== undefined ? `权威度 ${s.authority}/5` : ""].filter(Boolean).join("｜");
      // 元宝的摘要全部给模型（平均约 1650 字）；研究 Agent 读过全文的来源改用正文；配图描述接在后面
      return `[${i + 1}] ${s.title}${tags ? "｜" + tags : ""}${s.text ? "｜已读全文" : ""}\n${s.text ?? s.snippet}${captionLine(s)}`;
    })
    .join("\n\n");
}

/** 看图：视觉模型把图片转成文字，供后续改写搜索词与回答使用；不回答问题本身 */
export const VISION_MARK = "把图片转成文字";

export function visionPrompt(question: string, images: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你负责${VISION_MARK}，交给研究助手回答用户的问题。
- 先用一句话说明图片是什么（照片、截图、图表、文档、商品等）。
- 再列出与问题相关的关键信息：图中文字原样摘录，数字、日期、人物、物品、地点、品牌，图表的坐标与趋势。
- 只写看得到的，不推测、不评价，也不回答问题本身。
- 纯文本，不超过 300 字。${images.length > 1 ? "多张图片按「图1」「图2」分别描述。" : ""}`,
    },
    {
      role: "user",
      content: [
        ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        { type: "text" as const, text: `问题：${question}` },
      ],
    },
  ];
}

const imageBlock = (note?: string) => (note ? `用户附带的图片（已转成文字）：\n${note}` : "");

/** 模型能直接读图时，用户附的图片原样放在文字前面；没有图片时就是一段文字 */
const withImages = (text: string, images?: string[]): ChatMessage["content"] =>
  images?.length ? [...images.map((url) => ({ type: "image_url" as const, image_url: { url } })), { type: "text" as const, text: `用户附带了上面的图片。\n${text}` }] : text;

/**
 * 研究 Agent（research.ts）的提示词，同一段对话：第一步规划检索（search 动作，由 research.parseSearch 校验），之后每轮收到搜索结果，
 * 判断够不够：够了用 done 动作，不够就再给查询词。前面搜过什么、为什么还缺，后面都看得到。
 */
export function researchPrompt(question: string, path: { q: string }[], imageNote?: string, searched: string[] = [], canRead = false, official = false, memory?: string, images?: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是研究助手，负责为用户的问题检索资料：先把问题改写成搜索引擎查询词并规划检索，之后每轮会收到搜索结果，由你判断资料够不够、要不要换词再搜。今天是 ${today()}。

第一步，规划检索：
- 结合上下文路径补全“它”“这个”等指代，去掉口语和客套；每个查询词不超过 20 字。
- 输入是念头、情绪或处境（纠结要不要做某事、担心、觉得亏）时，只搜里面可以查证的事实（价格、数据、政策、产品），不搜情绪本身。
- 查询词 1 到 4 个，按问题需要决定：单一事实 1 个；涉及多个方面、对比或需要多方说法时，每个方面一个，彼此不重复。
- time 只在问题需要近期信息时填写：d7（近 7 天）、m1（近 1 个月）、m6（近半年）、y1（近 1 年）；不需要就省略。
- field 只在明显属于某个领域时填写：gov（政策法规）、news（新闻时事）、acad（学术研究）、finance（财经数据）；一般问题省略。
- site 是限定站点，只填一个具体网站的域名，不带 http 和路径，例如 www.mohrss.gov.cn、react.dev，不要只写 gov.cn、com.cn 这类后缀（实测搜不到）；政府网站整体用 field 的 gov 即可。全网结果里常混着搬运站和营销文章，所以编程技术、学术研究、政策法规、具体产品或公司这几类问题，至少拿出一个查询词限定最对口、最权威的站点：编程技术用官方文档站、github.com、stackoverflow.com，以及 juejin.cn、cnblogs.com 这类中文技术社区；学术用 arxiv.org 这类论文站；政策法规用对应的政府网站；产品、公司或开源项目用它的官网。国内和国外的站点都可以用，同一个方面可以分别限定一个国内站点和一个国外站点。限定站点之外至少保留一个不限站点的查询词；生活常识、新闻时事这类一般问题不填。${official ? "\n- 用户要求优先官方与权威来源：不管什么问题，每个方面都至少有一个查询词限定官方网站（官网、官方文档、政府网站），或用 field 限定 gov、news、acad；限定站点之外仍保留一个不限站点的查询词。" : ""}
- 发展快的领域（AI、科技产品、互联网、政策、市场行情等），即使问的是概念或原理，也至少用一个查询词带 time（y1 或 m6）查这个话题的最新进展和现状，否则容易只搜到几年前的老文章。
- quick 只在问题是单一事实或实时数据、一轮搜索就能答时填 true，比如天气、股价、航班、日期、某个数字或定义；需要分析、对比、多方说法的不填。
- sources 是整理答案需要的来源总数，取 5 到 20 的整数，按问题自己判断，不要照抄示例：单一事实 5 到 6；一般问题 8 到 12；涉及多个方面、对比、争议或需要多方说法时 14 到 20。
- 问题提到图片时，用图片内容里的具体对象（名称、型号、文字）来写查询词。${searched.length ? "\n- 这是补充检索：换不同的角度和说法，找已搜过的查询覆盖不到的信息，不要重复。" : ""}
输出一个搜索动作，例如：{"action":"search","queries":[{"q":"内存价格 上涨 原因","time":"m1"},{"q":"HBM 产能 挤占 DDR5","field":"news"}],"sources":N}（N 按上面的规则取整数）；限定站点写作 {"q":"useEffect 清理函数","site":"react.dev"}

之后每轮收到搜索结果时：
- 资料已能回答，或问题属于常识、方法建议、一般原理这类主要靠通用知识就能答好的，判定为够，输出 {"action":"done"}。判定为够时，用 drop 列出不要交给写答案的来源：明显离题的、内容农场、营销软文、和别的来源内容重复的，每条写序号和理由，理由只能是离题、内容农场、软文、重复之一；拿不准的留着，都能用就不写 drop，例如 {"action":"done","drop":[{"id":4,"why":"离题"},{"id":9,"why":"重复"}]}。
- 只有缺少关键事实、数据、最新进展，或问题的某个方面完全没被覆盖时，才继续搜索：用 missing 一句话写清还缺什么，再给 1 到 2 个新的查询词（可带 time、field），换角度或换说法，也可以换一个限定站点，或去掉没有结果的站点限定，不要与搜过的重复，例如 {"action":"search","missing":"还缺什么","queries":[{"q":"..."}]}。${canRead ? `
- 摘要只是网页的片段。问题需要深入的细节、完整的步骤或论证，而某几条来源看起来正好讲这些、摘要却不够时，可以读这些来源的全文：一次最多 3 篇，用 reason 写清为什么要读，例如 {"action":"read","ids":[3,7],"reason":"要完整的实验数据"}。读网页每篇要几秒，摘要已经够用时不要读。` : ""}${memory ? "\n\n" + memory : ""}

每一步只输出一个 JSON 动作，不要多余的话。`,
    },
    {
      role: "user",
      content: withImages([
        path.length ? "上下文路径：" + path.map((p) => p.q).join(" → ") : "",
        imageBlock(imageNote),
        searched.length ? "已搜过：" + searched.join("；") : "",
        `问题：${question}`,
      ].filter(Boolean).join("\n"), images),
    },
  ];
}

/** 研究循环里一轮搜索的结果：只给新增的来源（序号接着已有的往下排），摘要比写答案时短，够判断即可 */
export function researchObservation(round: number, fresh: Source[], offset: number, total: number, hits: { q: string; n: number }[] = []) {
  const list = fresh.map((s, i) => `[${offset + i + 1}] ${s.title}｜${[s.site, s.date].filter(Boolean).join("｜")}\n${s.snippet.slice(0, 300)}`).join("\n\n");
  // 各查询返回几条：限定站点的查询可能搜不到，模型据此换站点或去掉限定
  const perQuery = hits.length > 1 || hits.some((h) => !h.n) ? `\n各查询返回：${hits.map((h) => `「${h.q}」${h.n} 条`).join("；")}` : "";
  return `第 ${round} 轮搜索结果：新增 ${fresh.length} 条，累计 ${total} 条。${perQuery}\n${list || "（没有新结果）"}\n\n资料够不够？按规则只输出一个 JSON 动作。`;
}

/** 研究循环里读全文的结果：给开头一段让模型判断读到了什么，完整正文交给写答案的主模型 */
export function readObservation(results: { n: number; title: string; text?: string; error?: string }[]) {
  const list = results.map((r) => (r.text
    ? `[${r.n}] ${r.title}｜已读全文 ${r.text.length} 字，开头：\n${r.text.slice(0, 600)}`
    : `[${r.n}] ${r.title}｜读取失败：${r.error}`)).join("\n\n");
  return `全文读取结果：\n${list}\n\n资料够不够？按规则只输出一个 JSON 动作。`;
}

/** 看看新进展：只讲 since 以来的变化，并和上一层的结论对照；没查到就如实说，不凭记忆补 */
const updateRule = (since: string) => `这是对探索路径最后一层的跟进：只写 ${since} 至今的新变化，并和那一层的结论对照，说明哪些变了、有没有推翻之前的说法。搜索结果里发布早于 ${since} 的内容不算新进展。没有查到新变化时，结论直接写「${since} 以来没有查到新的进展」，不要用自身知识补充。`;

export function answerPrompt(question: string, path: { q: string; summary: string }[], existing: string[], sources: Source[] | null, imageNote?: string, since?: string, prefs?: Prefs, memory?: MemoryBrief, images?: string[]): ChatMessage[] {
  const reader = prefs?.style !== "custom";
  return [
    {
      role: "system",
      content: `你是「知多少」的研究助手，帮用户一层层弄懂一个话题。
${sources ? CITE_RULE : NO_SEARCH_RULE}
${timeRule(!!sources?.length)}${since ? "\n" + updateRule(since) : ""}${reader ? "\n" + READER_RULE : ""}${styleRule(prefs)}${memory?.answer ? "\n" + memory.answer : ""}
${THINK}

${format(!!sources?.length, prefs?.style, reader)}${!path.length && !since ? "\n\n" + frameRule(!!sources?.length) : ""}`,
    },
    {
      role: "user",
      content: withImages([
        path.length ? `探索路径（从起点到上一层）：\n${path.map((p) => `- ${p.q}：${p.summary}`).join("\n")}` : "",
        // 标明「不代表回答过」：模型会把列在这里、还没点开的问题当成答过，判断起点的几件事都弄清了
        existing.length ? `已有问题（地图上列出过的，用来避免重复，不代表回答过）：\n${existing.join("\n")}` : "",
        sources ? `搜索结果：\n${formatSources(sources)}` : "",
        imageBlock(imageNote),
        `问题：${question}`,
      ].filter(Boolean).join("\n\n"), images),
    },
  ];
}

const OP_TASK: Record<OpKind, string> = {
  summary: "把这些节点整合成一个整体结论，指出最重要的共同发现。",
  relate: "找出这些节点之间的关系（因果、并列、递进或矛盾），说明串起它们的关键线索。",
  deepen: "在这些节点的基础上更深入一层：补充细节、数据和最新进展。",
  expand: "从这些节点的交汇处提出新的探索方向，重点放在追问。",
  custom: "按用户的指令处理这些节点。",
};

export function synthesizePrompt(op: OpKind, instruction: string | undefined, nodes: NodeContext[], sources: Source[], existing: string[], search: boolean, prefs?: Prefs): ChatMessage[] {
  // 扩散重在追问，长度固定按简洁写；简洁、详细这两种管详略的风格与它冲突，不加，管措辞的风格照加
  const expand = op === "expand";
  const style = expand && (prefs?.style === "concise" || prefs?.style === "deep") ? undefined : prefs;
  return [
    {
      role: "system",
      content: `你是「知多少」的研究助手。用户在知识地图上选中了几个节点，需要你综合处理。
任务：${OP_TASK[op]}
${search || sources.length ? CITE_RULE : NO_SEARCH_RULE}
${timeRule(sources.length > 0)}${styleRule(style)}
${THINK}

在下面格式的最前面加一行：
标题：<结果节点的标题，问句或短语，不超过 22 字>
${format(sources.length > 0, expand ? "concise" : prefs?.style, false)}`,
    },
    {
      role: "user",
      content: [
        `选中的节点：\n${nodes.map((n, i) => `${i + 1}. ${n.q}\n结论：${n.summary}\n${n.points.map((p) => "- " + p.text + p.cites.map((c) => `[${c}]`).join("")).join("\n")}`).join("\n\n")}`,
        existing.length ? `已有问题：\n${existing.join("\n")}` : "",
        sources.length ? `来源：\n${formatSources(sources)}` : "",
        op === "custom" && instruction ? `用户指令：${instruction}` : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

/** 延伸列表底部的输入：判断意图，回答问题还是给出更多探索方向。输出由 router.ts 的 ask / branch 动作校验 */
export function commandPrompt(input: string, node: { q: string; summary: string }, path: { q: string; summary: string }[], existing: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `用户在知识地图的一个节点下输入了一句话，你来判断该怎么处理。今天是 ${today()}。
- ask：这是一个需要回答的问题（追问、请你解释、对比、查资料、给建议都算）。把它改写成一个完整、独立的问句：结合当前节点补全“它”“这个”等指代，保留用户原意，不超过 40 字。
- branch：用户想要更多可以继续探索的方向（如“再给几个关于成本的问题”“还能从哪些角度看”）。按用户关心的方向给出新的问题，数量由你按需要决定，一般 2 到 5 条、最多 6 条，宁少勿滥；每条带一个 2 到 4 字的角度标签，问句不超过 22 字，不要与已有问题重复或同义。
拿不准时按 ask 处理。
只输出 JSON，二选一：{"action":"ask","question":"..."} 或 {"action":"branch","questions":[{"dir":"角度","q":"问句"}]}`,
    },
    {
      role: "user",
      content: [
        path.length ? `探索路径：${path.map((p) => p.q).join(" → ")}` : "",
        `当前节点：${node.q}\n结论：${node.summary}`,
        existing.length ? `已有问题：\n${existing.join("\n")}` : "",
        `用户输入：${input}`,
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

/** 详解：卡片已有精简回答，这里按问题需要展开，长度不设上限，但每句要有信息量 */
export function detailPrompt(question: string, path: { q: string; summary: string }[], node: NodeContext, pics: Pic[] = [], prefs?: Prefs): ChatMessage[] {
  const cites = (cs: number[]) => cs.map((c) => `[${c}]`).join("");
  const picRule = pics.length ? `
- 配图：下方「可用配图」是来源里的图片描述。某张图能直接帮助理解某一段（数据图表、实物、现场、流程示意）时，在那一段之后单独一行写 [图序号]；全文最多 3 张，宁缺毋滥，没有合适的就一张都不放，不要在正文里提到“见图”。` : "";
  return [
    {
      role: "system",
      content: `你是「知多少」的研究助手。用户已经在卡片上看到了精简回答，现在打开详情页，想把这个问题弄透。
在精简回答的基础上详细展开：补充原因与机制、具体做法或步骤、数据与例子、不同观点和适用条件。不要复述卡片上的原话。
长度按问题需要决定：具体问题写得紧凑，宽泛问题可以分多节展开；不要凑字数，每句都要有信息量。
${node.sources.length ? CITE_RULE : NO_SEARCH_RULE}
${timeRule(node.sources.length > 0, false)}${styleRule(prefs)}
${THINK}

只用以下 Markdown：
## 小标题
一段话
- 列表项（步骤、清单、对比时使用）${picRule}

共 2 到 6 节，第一节直接进入正题，不要写总标题和开场白。`,
    },
    {
      role: "user",
      content: [
        path.length ? `探索路径（从起点到上一层）：\n${path.map((p) => `- ${p.q}：${p.summary}`).join("\n")}` : "",
        `卡片上的精简回答：\n结论：${node.summary}\n${node.points.map((p) => "- " + p.text + cites(p.cites)).join("\n")}`,
        node.sources.length ? `搜索结果：\n${formatSources(node.sources)}` : "",
        pics.length ? `可用配图：\n${pics.map((p) => `[图${p.n}] ${p.caption}（来源 ${p.source}）`).join("\n")}` : "",
        `问题：${question}`,
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

export function summaryPrompt(nodes: NodeContext[], sources: Source[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `根据用户在知识地图上探索过的节点，写一页简洁、可直接分享的总结。
只用以下 Markdown：
# 标题
一段导语（2 到 3 句，概括全貌）

## 小标题
一段话

共 2 到 5 节，按逻辑而不是按节点顺序组织。句末用 [序号] 标注来源，序号对应来源列表；没有来源时不标注。不要写节点里没有的信息。
${THINK}`,
    },
    {
      role: "user",
      content: [
        `节点：\n${nodes.map((n) => `- ${n.q}\n  结论：${n.summary}\n${n.points.map((p) => "  · " + p.text + p.cites.map((c) => `[${c}]`).join("")).join("\n")}`).join("\n")}`,
        sources.length ? `来源：\n${sources.map((s, i) => `[${i + 1}] ${s.title}｜${s.site}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}
