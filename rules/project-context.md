---
template_state: ready
---

# 项目上下文

## 目标与边界

- 产品：「知多少」，一张会生长的知识地图。用户输入问题，先得到有来源、有时效的答案；系统再从答案延伸出具体问题（主动替用户提问），用户点开问题继续得到答案，逐层展开成画布上的知识树。
- 产品形态：Tauri 2 桌面应用（Windows 安装包分发），没有任何后端服务。用户在应用「设置」里填写自己的 API Key，应用在本机直接请求腾讯接口。
  - 不做纯网页版的原因：元宝搜索与 TokenHub 均不允许浏览器跨域调用（2026-10 实测预检分别返回 403 / 405），网页无法直连；用户已明确不要服务器或转发。
- 接入范围：只接入腾讯：大模型为混元（TokenHub 按量 API Key），搜索为元宝搜索（服务 API Key）。这是腾讯项目的约束。
- 已确认的核心交互：
  - 问题 → 答案 → 延伸问题（只有标题，点开才检索）→ 答案，循环往复；任意答案可追问。
  - 无限画布：拖动空白处平移、鼠标滚轮与 Ctrl + 滚轮缩放（每次事件幅度封顶约 12%，由 `createSmoothZoom` 在对数空间按 50ms 时间常数平滑趋近，期间比例被其他操作改动就放弃剩余缩放；触控板双指滑动也是缩放，捏合缩放；触屏单指平移、双指捏合）、Shift + 拖动框选、Ctrl/⌘ + 点击加选；选中两个以上节点后自动弹出「想对它们做什么？」，预设总结 / 找出关联 / 进一步了解 / 扩散，也可自行输入，结果生成综合节点并以虚线连回来源节点。
  - 拖动与选字：卡片只有标题行（问题）、标签与附图是拖动节点的把手（`Canvas.tsx` 的 `DRAG_HANDLE`）；结论、要点、智能卡片可以选中复制，没拖动也没选中文字时按点击处理。延伸问题整个可拖。折叠按钮放在卡片外、连线起点（标题行高度）上，不压住正文。
  - 右键菜单（[`ContextMenu.tsx`](../src/canvas/ContextMenu.tsx)，只接管画布，侧边栏等处保留系统菜单）：节点上有复制选中文字、打开详情、复制 / 导出为 Markdown，右键的节点在多选里时可合并导出；空白处有「在这里提一个新问题」（在点击处、压住节点就往下挪，另起一棵树便于对比，`actions.startHere`）、复制 / 导出整张地图、适应画布。Markdown 由 [`lib/export.ts`](../src/lib/export.ts) 生成（有单测）：每个节点一节，智能卡片转成表格，详解去掉 [图n]，来源列表带链接；导出经 Rust 命令 `save_markdown` 弹出系统「另存为」（tauri-plugin-dialog 只在 Rust 侧用，界面传不了任意路径），浏览器示例模式直接下载。
  - 拖上去连接：拖动回答节点时悬停在另一个回答完成的节点上，目标描边并浮出「松手，把它们连起来」（用 `--viz-accent`，默认墨色方案的主题色太淡），松手后节点回到原位、两者被选中，弹出「想对它们做什么？」。与 Shift 框选、Ctrl 加选并存。
  - 并排对比：节点右键「不联网再答一次，并排对比」（原节点没联网时是「联网再答一次」），生成固定联网方式的对比节点（`GNode.searchMode`，不跟随顶栏开关；`compareOf` 指回原节点，点线连接，卡片标签「对比 · 不联网 / 联网」），放在原节点右侧空位；对比节点不再提供这一项，也不计入个人记忆的提问。
  - 节点三层信息：卡片（问题、结论、来源图标、时效）→ 激活后展开要点（带来源角标）→ 再次点击打开详情侧边栏。卡片结论是用户第一眼要看的答案：提示词要求第一句就是精准答案（结论、数字、日期、是或否、做法），样式为中等字重、墨色。侧边栏不再重复卡片内容（用户要求）：标题栏只留一行问题，正文从「详解」开始，之后是来源（含「搜索更多来源」「看看新进展」）与延伸问题，不再有结论、要点与单独的「相关图片」区。「详解」默认在侧边栏里点「生成详解」才生成（按钮紧跟「详解」标题、左对齐；设置「打开详情时生成详解」可改为自动，`autoDetail`，用户要求默认手动）（`pipeline.detail`，主模型，Markdown 子集，复用节点来源），存在 `GNode.detail` 并随存档保存，节点重新回答时清空。详解里穿插配图：[`lib/pics.ts`](../src/lib/pics.ts) 先按元宝的图片描述去掉截图、网页、标志、图标、二维码、广告、头像等，并去重、限 8 张、编号，交给写详解的模型；模型在相关段落后单独一行写 `[图n]`（最多 3 张，可以不放），渲染为带说明与来源的插图，加载失败即隐藏。详解与总结的 Markdown 子集由 [`lib/markdown.ts`](../src/lib/markdown.ts) 逐行解析（标题、段落、无序 / 有序列表、`**粗体**`、单独一行的 `[图n]`）：模型常用单个换行分隔标题、正文和列表，不能只按空行分块。卡片上的要点完整显示，不做截断。
  - 智能卡片（`GNode.visual`，[`VisualCard.tsx`](../src/components/VisualCard.tsx)）：只在有搜索结果时，回答格式里多一行可选的「数据：」JSON，六种：柱状 bar（数值比较，可标 highlight 突出一项、其余变灰）、折线 line（随时间变化，悬停看各点）、环形 donut（构成）、表格 table、时间线 timeline、关键数字 stats，由模型按数据用途选，没有合适数据就不写；[`format.ts`](../src/core/format.ts) 的 `parseVisual` 校验并丢掉没有来源角标的条目，卡片里每一项都带角标（用户要求「可信」，数字不能是编的）。显示在卡片结论下方、和要点一起展开，详情侧边栏不重复。配色（[`tokens.css`](../src/styles/tokens.css)）：单一系列与装饰用 `--viz-accent`，默认墨色方案的强调色是灰，所以用 Radix blue，其他配色方案用各自强调色阶；环形图用固定分类色 `--viz-1..5`（Radix blue、tomato、jade、violet、pink，浅色 10 阶、深色 9 阶），按顺序取用，深浅两套都用 dataviz 校验脚本验证过；底色 `--visual-bg` 是同一色阶的淡层（浅色 3 阶、深色 2 阶）；文字只用墨色令牌。纯 SVG / CSS 绘制，没有图表依赖。卡片里每项最多留 3 个来源角标（解析时截断），显示前 1–2 个、其余折成「+N」，表格每行只显示 1 个；用户反馈角标挤乱排版。提示词要求能用数字图表就不用表格，问「提升多少」用关键数字写各项幅度。回答节点宽度 380px（`--card-w`，原 340，用户要求加宽）。不做地图与股票走势（没有可用数据源，用户不做财经）；天气等垂直数据只有元宝返回 VR 卡时才有。
  - 回答偏好（[`PrefsMenu.tsx`](../src/components/PrefsMenu.tsx)，设置里的 `prefs`，即改即存）：首页输入框与画布顶栏的「联网搜索」旁边，回答风格（简洁明了为默认 / 通俗易懂 / 详细深入 / 自定义一句话）、来源（自动 / 权威优先）、时间（自动 / 近一周 / 近一个月）。风格只改措辞与详略，作用于回答、综合与详解；权威优先写进检索规划提示词；时间范围像「看看新进展」一样由程序统一限定所有查询的 `Freshness`。回答提示词另有 `READER_RULE`：按提问方式判断对方懂多少，问得越短越基础（如「PHP 是啥」）越按入门读者答，结论说清是什么、干什么用，要点 4 到 6 条带例子、术语顺手解释；问题带术语、条件或对比时直接给精准答案（用户要求：问得简单说明啥都不懂）。用户选了自定义风格时不加这条。
  - 个人记忆（[`src/memory/`](../src/memory/)，本机 localStorage `zds-memory`，不上传；用户要求「越用越强」）：记忆就是一段文本（≤800 字，每行一条），原样交给检索规划与写答案，用户在设置「记忆」的文本框里直接改（用户要求：不分类、不分条管理）。
    - 信号：来源网站的点开与侧边栏阅读（`recordSite`）、延伸问题各角度的出现与点击（`recordAngle`）、第一次回答的提问与手动生成详解（进 `pending`）。
    - 整理：攒够 4 次提问后由快速模型（`completeFast`，FAST_MODEL）在后台把信号合进记忆文本、输出整段新文本（`consolidate.ts`）：现有内容尤其用户手写的优先保留，至少两次相关提问才写关注领域，不写隐私；空输出或整理期间用户改过记忆就不覆盖，信号放回下次再试。
    - 使用（`brief.ts`）：记忆文本交给检索规划（里面写的常看网站对口时可限定，落到元宝的限定站点参数上）与写答案（偏好照做）；另从历史地图里找相似的问题（去掉问句套话后 Dice ≥0.4 且共有 ≥3 个二元组，最多 2 条），把结论交给写答案，懂了的不再从头讲。
    - 透明可控：卡片要点下方一行标出记忆里写到、检索时真的限定过的站点，以及「你探索过」的历史问题（可点开那张地图）；设置「记忆」总开关；回答偏好弹层里可设「这张地图不用」（不记录也不使用，`offMaps`）。
  - 引用角标点击弹出引用气泡（[`CitePopover.tsx`](../src/components/CitePopover.tsx)）：来源标题、站点、原文，与被引用那句话最相关的一两句高亮（[`lib/match.ts`](../src/lib/match.ts) 按字二元组重叠打分，纯本地、不调用模型；读过全文的先在全文里找，找不到回到摘要；低于门槛就不高亮并说明，不硬凑），底部「打开原网页」用系统默认浏览器，节点里的角标另有「在侧边栏阅读」（按设置决定哪个是主按钮）。画布平移缩放、抽屉切换、滚动时关闭，别的节点流式输出不打断它。实测（2026-10，DeepSeek 话题 12 个角标）10 个找到对应句子，没找到的是模型的抽象概括。
  - 打开来源：设置「点击来源时」可选系统浏览器（默认）或侧边栏阅读视图（`openSource`）；来源列表、气泡都按它走，没有链接的权威卡片只能在阅读视图看。外链统一用 [`lib/external.ts`](../src/lib/external.ts)（模拟点击 `target="_blank"` 链接，由 opener 插件交给系统浏览器；它不检查 isTrusted，阻止默认行为后不会再打开）。
  - 来源阅读视图（[`Reader.tsx`](../src/components/Reader.tsx)，graph store 的 `reading`）：侧边栏里逐层进入，顶部「← 详情」、路径「节点 › 来源 n/总数」、上一条 / 下一条、浏览器打开；没读过全文的打开时自动读取（先显示摘要），读到后写回 `Source.text`（写答案、气泡也能用）；这个节点里所有引用了该来源的句子（`match.quotesFor`：结论、要点、详解）列成可跳转的条目并在正文里高亮。← → 切换来源，Esc 先回详情再关侧边栏。切换节点或重新打开详情时退出阅读视图。
  - 侧边栏宽度：拖左边缘调整、双击恢复 420，记在设置 `drawerWidth`（360 到窗口 60%），写到 Workspace 的 `--drawer-w`，画布的可用区域（`view.viewport`）同步；窄窗口时占满。切换节点时上一个节点的要点默认保持展开（用户要求，设置版本 2 迁移时老用户也改一次），设置里可改为自动收起（激活过的节点记在 graph store 的 `opened`，随存档保存为 `MapRecord.opened`，重新打开地图后保持展开）。
  - 延伸问题的角度标签（卡片上的 `dir`）由模型按问题自拟 2 到 4 字，数量由模型决定（最多 6 条，宁少勿滥；不需要扩散时写「追问：无」，解析器据此不产出延伸问题），不再是固定列表；用户追问的节点 `dir` 为「追问」。
  - 当前节点（已完成的回答）的延伸列表最下方有一个输入框（`layout` 的 `slot`，不是节点）：输入交给 [`router.ts`](../src/core/router.ts)（跑在 Agent 内核上、只走一步），轻量模型判断意图——ask 则把输入改写成完整问句、新建追问节点并回答；branch 则在该节点下补充新的探索方向（数量自定、最多 6 条）；拿不准或解析失败按 ask 处理。
  - 兄弟节点按实际占地紧凑排列（`layout.ts`：后一个兄弟只避开左右重叠的后代，不把整棵子树当矩形，否则右侧子列很长时下方会空出一块）；当前路径高亮、其他分支变淡（回答卡片 0.55、延伸问题 0.8、连线 0.5：用户要求别的方向一直看得清，引导换方向继续问）；卡片的时效写作「最新发布于 …」，指最新来源的发布时间而不是提问时间；面包屑回退；分支折叠；缩放低于 55% 只显示标题；平移缩放时画布（`.world`）临时加 `will-change: transform`（`is-moving`，停止 180ms 后撤掉）：过程中按图层拉伸保证帧率，停下后按最终比例重绘保证清晰；节点不能常驻 will-change，否则放大后一直发虚（用户实测）；总结面板支持整张图 / 当前路径 / 选中节点并可复制文本。
  - 窗口外观：无系统边框，自绘标题栏（[`TitleBar.tsx`](../src/components/TitleBar.tsx)）。画布顶栏即标题栏，首页有一条透明标题栏；空白处拖动、双击最大化，右侧为 Windows 风格窗口按钮，失焦变淡；发布版屏蔽 WebView 右键菜单（输入框除外）。新增顶栏元素时，容器保留 `drag` 属性，可点击的子元素不要加。
  - 并行与离开：可以同时点开多个延伸问题，各自独立回答；进行中的节点不参与非当前路径的变淡。离开还在回答的地图（点标题栏左上角的返回图标回首页、从历史打开别的地图，统一走 `actions.leave`）时按设置 `onLeave` 处理：后台继续（默认，不打断用户，回答完会提示）、每次询问（弹出 [`LeaveDialog`](../src/components/LeaveDialog.tsx)：只有标题，没有说明文字，右上角关闭即留在当前地图；左下「记住我的选择」默认不勾；右下危险色字的「全部终止」与墨色实底的「后台继续回答」）、终止；设置「画布与来源」里可改。在后台继续：地图状态移到 `core.parked`，进行中的回答 / 综合 / 详解经 `patchAt` / `addAt` 写回那里（新节点接着该地图自己的最大编号），延迟存档；全部完成后立即存档、移出后台并提示「已在后台回答完成」带「打开」；放到后台时立刻加进历史列表（第一个回答还没完成、尚未存档也加，打开时用内存里的状态；全部失败则移除），首页与历史列表显示转圈的「后台回答中」且不能删除；确认弹窗开着时已经答完的，选后台继续也不进后台、照常自动保存（否则没有结束事件把它移出后台）；再次打开时直接用内存里的最新状态，进行中的请求继续写回画布。输入框的意图判断在离开时一律取消。关窗时后台地图也写一次，未完成的节点下次打开标为中断。
  - 对话框（设置、历史、总结、离开确认）只盖住内容区，标题栏保持清晰可用；设置在宽窗口（≥ 900px）分两栏：左边两个密钥，右边画布与来源；面板高度不超过可视区域，内容在面板内滚动。
  - 设置入口：首页右上角与画布顶栏的齿轮按钮；密钥未填全时提问会先打开设置；密钥类错误的卡片提供「设置」按钮。
- 设计风格：专业、简洁、克制、高级。用户否定了朱砂（偏橙）强调色：默认配色为「墨色」（中性冷灰，强调色是石板灰，几乎只有黑白灰）；设置「外观」可换靛青、石青、松绿、胭脂、黛紫（`settings.palette` → html 的 `data-palette`，令牌在 [`tokens.css`](../src/styles/tokens.css) 末尾，每套各有浅色与深色，在首次渲染前写到 html 上）。明暗在「外观」里选跟随系统（默认）/ 浅色 / 深色（`settings.theme` → html 的 `data-theme`，跟随系统时不写）；`tokens.css` 里每个深色块写两遍（系统深色且未选浅色、选了深色），改深色令牌时两份要一起改。窗口无系统标题栏（`decorations: false`），不需要同步原生窗口主题。颜色全部来自 Radix Colors（用户要求）：每套配色是一条灰阶加一条强调色阶（墨色 slate+slate、靛青 slate+indigo、石青 sage+teal、松绿 sage+jade、胭脂 mauve+crimson、黛紫 mauve+violet），色阶由 `@radix-ui/colors` 3.0.0 的官方值生成，语义令牌按 Radix 分阶用法映射一次；危险色（终止、错误）用 red。字体全站统一无衬线（用户否定了衬线与无衬线混用）：`--font-ui` 依次为 -apple-system（苹果即苹方）、HarmonyOS Sans SC、MiSans、苹方、微软雅黑，苹方须排在 HarmonyOS 之后（有的 Windows 也装了苹方）；不加载网络字体。Logo 例外：首页与画布标题栏的「知多少」用 [`Wordmark`](../src/components/Wordmark.tsx)，是思源宋体 Heavy（OFL）的字形轮廓 SVG（字间距 0.14em，颜色跟随 currentColor），用户电脑不需要装这款字体；用户从多款宋体与设计稿中选定。字号只有 12 / 13 / 15 / 20 四档（用户要求不超过四种、最小 12px），层级靠字重与颜色：标题 600、结论 500、正文 400；阅读正文（详情、总结、阅读视图）用 15px、`--read-lh` 1.85、`--read-track` 0.01em。线条 0.5px，动效基础 250ms ease-out，见 [`frontend-ui.md`](frontend-ui.md) 的视觉基线。用户已否定「星图风」「纸面笔记风」等装饰性方向。
- 当前非目标：账号体系、跨设备同步历史记录、导出图片、主题手动切换、首页推荐或实时热点（首页只显示用户自己的最近记录）、触屏多选、自动更新、macOS 打包。

## 权威入口与特殊约束

- 编排与契约都在前端 [`src/core/`](../src/core/)：
  - [`protocol.ts`](../src/core/protocol.ts) 定义界面与编排层之间的请求和流式事件；界面只通过 [`src/api/client.ts`](../src/api/client.ts) 调用编排，并在这里把异常统一转成带 `code` 的 error 事件。
  - Agent 内核 [`agent.ts`](../src/core/agent.ts)：模型每一步（快模型、JSON 模式）输出一个 `{"action": ...}`，程序按注册的动作逐个校验参数并执行，结果作为观察喂回同一段对话，直到动作给出结果或预算（步数、时长）用完；输出不合法时走调用方给的兜底动作，每一步写调试日志。新增 Agent 能力就是注册动作，不另写循环。
  - 研究 Agent [`research.ts`](../src/core/research.ts)：动作 `search`（查询词 1 到 4 个，各自可带时间范围与领域；首轮来源总数 5 到 20 由模型定、每个查询词至少 4 条，补搜每轮最多 2 个词、新增 6 条）、`read`（摘要不够深时读来源网页全文：每次最多 3 篇、整个研究最多 4 篇，正文挂到 `Source.text`，写答案时优先用全文；失败的告诉模型）与 `done`。整个循环是同一段对话（`researchPrompt` + 每轮 `researchObservation`），复查看得到之前的规划、各轮结果与上一轮说的缺口；搜索最多 3 轮、决策最多 6 步、约 45 秒；常识、方法类问题判为够；还没搜过就 done 或输出不可用时按原问题搜一轮。提示词示例里不要写具体数字，实测模型会照抄示例值。搜索：每个查询的 `Cnt` 按总数平分取档，多查询交错去重。
  - [`pipeline.ts`](../src/core/pipeline.ts)：看图 → 研究 Agent → 主模型按行格式流式输出 → [`format.ts`](../src/core/format.ts) 增量解析为结论 / 要点 / 追问；另有综合、总结、详解。改提示词（[`prompts.ts`](../src/core/prompts.ts)）的输出格式时必须同步解析器与其测试。
- 供应商可替换：接口在 [`providers/types.ts`](../src/core/providers/types.ts)（`LLMProvider`、`SearchProvider`、可注入的 `HttpFetch`），按设置创建的注册表在 [`providers/registry.ts`](../src/core/providers/registry.ts)。新增供应商只加实现文件和注册分支，并把其域名加入 Tauri 白名单；编排层与界面不改。
  - 大模型：[`tokenhub.ts`](../src/core/providers/tokenhub.ts)，`https://tokenhub.tencentmaas.com/v1`（OpenAI Chat Completions 兼容，一个 Key 可调混元、DeepSeek 等）。资料：<https://cloud.tencent.com/document/product/1823/132252>、DeepSeek 调用指南 <https://cloud.tencent.com/document/product/1823/132248>。
    - 任务分档的唯一入口是 [`models.ts`](../src/core/models.ts)：
      - `main` = 设置里选的主模型（默认 `hy4-preview`，可选 `hy3`），用于整理答案、综合节点、总结，开启思考并带 `reasoning_effort: "low"`；
      - `fast` = `deepseek/deepseek-flash`，带 `thinking: {type: "disabled"}`，用于改写搜索词。模型 ID 以账号控制台「在线推理服务」列表为准：文档里的 `deepseek-v4-flash` 实测返回 400004（不存在）。
      - `vision` = `hy-vision-2.0-instruct`（混元视觉模型），用于看图。混元语言模型（hy4-preview、hy3）官方文档写明不支持图片输入，所以用户附图时先由它把图片转成文字（`see` 阶段，描述流式显示在等待动画里），描述再进入改写搜索词和回答的提示词，并存到节点的 `imageNote` 上，重试时不再重复识别。视觉模型没有思考开关（`thinking: null`），请求里不带思考字段。资料：<https://cloud.tencent.com/document/product/1823/136956>。同平台的 `deepseek/deepseek-v4-flash-vision-exp` 是实验版，未选用。截至 2026-10 尚未用真实 Key 验证这个模型 ID 在账号下可用。
      编排层只传 `tier`，不写具体模型名。设置页的连接测试并行验证三档模型，用极简提示“回复 OK”、关闭思考、`max_tokens: 4`；实测总耗时约 3 秒，基本是网关往返时间。
    - 图片：前端在 [`src/lib/image.ts`](../src/lib/image.ts) 压缩（长边 ≤ 1600px、JPEG 0.86、单文件 ≤ 20MB、最多 4 张），以 base64 data URL 放进 `image_url` 内容块；历史记录里也保存压缩后的图片。调试日志会把 base64 替换为长度说明。窗口配置 `dragDropEnabled: false`，否则 Tauri 会拦截文件拖放，网页收不到 drop 事件。
    - 流式增量里的 `reasoning_content`（思维链）作为 `ChatDelta.reasoning` 透传，编排层转成 `thinking` 事件，只用于等待动画（[`ThinkingStream.tsx`](../src/components/ThinkingStream.tsx)），不进入答案；换阶段时清空。
    - 实测（2026-10，优化前，全部用 Hy4 Preview）：改写搜索词思考约 1000 字、约 22 秒；整理答案思考约 4000 字，整次提问约 85 秒。
    - 快模型能力（2026-10 用真实 Key 实测 `deepseek/deepseek-flash`）：支持 `response_format: {type: "json_object"}`（含流式）和原生工具调用（`tools`，可一次并行发起多个调用），单次约 3 秒。研究循环的规划 / 复查与输入框路由都开了 JSON 模式（`ChatOptions.json`）；原生工具调用暂未使用，留给 Agent 内核阶段评估。混元带 `tools` 时 `reasoning_effort: low` 会被强制改为 high（官方文档），主模型不要带工具。
    - 实测（2026-10，研究循环 + JSON 模式，问「怎么养成早睡早起的习惯？」）：规划 3 个查询词约 3 秒，搜索得 12 条，复查判为常识类足够约 2.8 秒，研究阶段共约 6.4 秒；主模型整理答案约 60 秒（思考约 2800 字），总计约 66 秒。
- 提示词（[`prompts.ts`](../src/core/prompts.ts)）：
  - 回答以搜索结果为主并标 [序号]；搜索没覆盖的常识、方法、原理允许模型用自身知识补充（不标序号），具体数据、日期、最新动态只用来源；不写「材料未提及」之类的话。
  - 规则放 system、材料放 user、问题放最后；给一个格式示例，并要求思考简短、不复述格式；来源摘要整条给模型（元宝动态摘要平均约 1650 字，研究 Agent 读过全文的用正文），后面接「配图：」一行（`captionLine`：元宝的图片描述去重、每条截 40 字、每个来源最多 4 条），模型可引用该来源序号，追问也可从配图线索找方向。
  - 「已有问题」只取路径上的节点、它们的子问题和来源节点，最多 20 条（`relatedQuestions`）。
  - Coding Plan（`sk-sp-`）与 Token Plan（`sk-tp-`）套餐密钥的条款禁止用于自定义应用后端，设置页与注册表都会拒绝；只接受 TokenHub 按量 API Key。资料：<https://cloud.tencent.com/document/product/1823/130092>。
  - 元宝搜索：[`yuanbao.ts`](../src/core/providers/yuanbao.ts)，`POST https://api.wsa.cloud.tencent.com/SearchPro` + `Authorization: Bearer <API Key>`，参数同 SearchPro：已用 `Query`、`Cnt`、`Freshness`、`Industry`（gov / news / acad / finance）、`Site`（限定一个域名，各版本都支持，只对自然结果生效）、`Mode: 2`（自然结果 + 权威 VR 卡）、`Deeplinks`（仅确认是旗舰版后才发）。响应的 `Version`（lite / standard / flagship）按密钥记在内存里，极速版不发 `Cnt`、`Mode`、`Industry`；设置页测试连接会显示版本。
    - 结果字段：`pics` → `Source.pics`（详情抽屉「相关图片」，`no-referrer` 加载，失败即隐藏），`deeplinks` → `Source.links`（来源下方的附件子链），`authority_level` → `Source.authority`（≥4 显示「权威」，并写进来源提示词）。`score` 未使用。`deeplinks`、`authority_level` 只有旗舰版返回；用户账号为标准版，功能不要依赖这两项。用户已决定：拿不到 `authority_level` 就不做“传统搜索结果页按权威度排序”这类功能。
    - 检索规模：研究 Agent 每轮搜索后发 `searched` 事件（去重前返回条数），累计到 `GNode.searchResults`（随存档保存，重新回答清空、搜索更多来源累加）；复查阶段状态显示「元宝搜索返回 N 条结果」，详情抽屉「来源」标题旁显示「从 N 条结果中选出 M 条」（综合节点不显示，其来源含合并来的）。用户后来改了决定（2026-10）：显示元宝搜索的速度与条数。加载时状态写「元宝搜索 0.5 秒返回 N 条」（统一按秒、一位小数；只搜一轮就作答的简单问题在查阅来源时也显示），侧边栏在详解之后有「检索过程」（[`SearchLog.tsx`](../src/components/SearchLog.tsx)）：每条查询的参数（时效、领域、限定站点）做成小标签、各返回几条、分轮次，标题旁是查询次数、总条数与耗时；数据来自 `searched` 事件里的 `plans` 与 `ms`，存在 `GNode.searches` / `searchMs`。加载时卡片只报阶段与累计数字，不逐轮播报查询词和「第几轮」，每条状态至少停留 1.6 秒、新旧两句叠化切换（`StatusText`），换阶段时思考流接着滚、不清空；用户反馈逐轮切换太快、一闪一闪。检索过程里只在补充的那一轮前加「第 N 轮补充检索」，不回头给第一轮补标题。
    - 版本与开通（2026-10 文档）：极速版 14、标准版 20、旗舰版 26 元/千次，旗舰版仅限企业用户开通；控制台「标准版」也叫「尊享版」，「极速版」也叫「轻量版」。用户账号为标准版。
    - 2026-10 已记录的 13 次真实响应（标准版、`Mode: 2`，睡眠、固态电池、DeepSeek、训练 GPT 等问题）都没有 VR 卡；技术类问题结果里有 github.com、dev.to 等境外站点，也夹杂低质量的聚合站。
    - 限定站点：研究 Agent 的查询可带 `site`（也接受查询词里写 `site:域名`），按问题挑对口站点，国内外都可以；首轮全部限定时程序补一个全网查询。查询的唯一写法是 `queryKey`（「查询词 site:域名」），用于去重、「已搜过」与加载状态显示；每轮观察会告诉模型各查询返回几条，限定站点搜不到时由它换站点或去掉限定。2026-10 实测 `Site: gov.cn` 返回 0 条（同时 `Industry: gov` 的结果全是政府网站），因此提示词要求写具体网站域名，`parseSite` 把 gov.cn、com.cn 这类只有后缀的写法当作不限站点；具体网站域名能否命中尚未用真实请求验证。
    - 简单问题快速路径：首轮规划可带 `quick: true`（单一事实或实时数据，如天气、股价、日期）；搜到结果后直接结束研究、不复查，主模型关闭思考整理答案。实测（2026-10）问天气时研究约 7 秒、主模型思考约 2000 字共约 47 秒，思考是主要耗时；走快速路径后同一问题总计约 11.7 秒（规划 3.2 秒、搜索 0.4 秒、主模型 8 秒），并出现天气 VR 卡；没搜到结果时照常复查。VR 卡时有时无：2026-10-22 问「北京今天天气怎么样？」（查询「北京 今天 天气」）10 条全是普通网页，没有 VR 卡。
    - 决策时限：Agent 每次决策（轻量模型）限时 `DECIDE_MS` 12 秒，超时按输出不合法走兜底动作（研究循环即结束检索）；实测一次复查卡了约 35 秒才返回。
    - 错误展示：error 事件带 `hint`（`ProviderError.info.hint`），写到 `GNode.errorHint`，卡片与详情抽屉在错误下方显示原因与处理办法。网络层失败（请求没送达，如 Tauri 报 error sending request）提示检查网络、代理或 VPN；TokenHub 402 为余额不足、429 为请求频繁。2026-10 实测一次「无法连接」是请求约 5 秒后没送达，并非余额问题；用户机器经本机代理（127.0.0.1:17897）上网。
    - 看看新进展：详情抽屉在节点回答完成 1 小时后提供（`newsSince`：取 `GNode.answeredAt` 那天，早期存档取最新来源日期；综合节点、没有来源的不提供）。新建 `dir` 为「新进展」的子节点并记下 `since`，检索时所有查询的 `Freshness` 统一为「since,今天」、跳过父节点已有来源；回答提示词要求只写新变化并与上一层对照，没查到就如实说（即使 0 条来源也不走「未联网」提示词）。重试沿用 `since`。
    - VR 卡（2026-10 实测，标准版，问「深圳明天天气」）：条目带 `vr: true`、`vr_category`（如 weather）、`vrid`，有 url，没有 content，passage 是「# 键：值」逐行文本并夹着多条「跳转地址」。解析为 `Source.card` + `cardType`，摘要经 `cardText` 去掉跳转地址行与行首 #；来源列表显示「权威卡片 · 天气」（`cardLabel` 只收实测见过的类别），详情抽屉里卡片摘要最多显示 8 行。睡眠、电池、编程等一般问题实测没有 VR 卡。以下为早期按文档推测的说明：官方文档（2026-10）只说明 `Mode` 取值，没有给出 VR 卡在 `Pages` 里的结构或示例。目前按「没有链接但有标题和摘要」或带 vr 类标记识别为 `Source.card`，`id` 为 `card:标题`、`url` 为空；来源去重统一按 `id`。拿到真实响应后应按实际字段修正 `parsePages`，原始响应可在 `.debug/network.jsonl` 查看。2026-10 实测（标准版、`Mode: 2`、睡眠类问题）：10 条全是普通网页结果，字段为 title / url / date / passage / content / site / favicon / score / pics，与文档一致，没出现 VR 卡。
    - 搜索更多来源：`AnswerRequest.more` 带上节点已用的查询词（`GNode.queries`）与已有来源，改写阶段换角度补充检索，已有来源序号不变、新来源接在后面，单节点最多 40 条（`SOURCES_CAP`），随后重新整理答案和延伸问题。资料：<https://cloud.tencent.com/document/product/1806/130615>、<https://cloud.tencent.com/document/api/1806/121811>。API Key 在 <https://console.cloud.tencent.com/wsapi/index?tab=apikey> 创建。
    - 已知行为（2026-10 实测）：错误都以 HTTP 200 + `Response.Error` 返回。密钥错误、缺失、被删除，或刚创建尚未生效（创建后数秒内实测如此，稍后即可用）时，一律返回 `UnauthorizedOperation`，无法区分具体是哪种；与 `Cnt` 参数、请求来源无关。
  - 错误映射：`searchError` / `llmError` 把服务错误码转为一句话结论 + 原因与处理办法（`ProviderError.info.hint`）+ 错误码与 RequestId。设置页测试连接时完整展示，映射关系有单测（`errors.test.ts`）。
  - 示例供应商（`mock.ts` / `mock-data.ts`）只在开发环境且 `VITE_PROVIDERS=mock` 时启用，不得作为真实供应商失败时的回退；发布版本始终使用真实服务。
- 页面切换动画（[`lib/transition.ts`](../src/lib/transition.ts)）：打开历史、回首页用 View Transitions 交叉淡入；首页提问用 `morphToCard`：首页克隆成残影淡出，一个外壳从提问框连续形变（位置、尺寸、圆角、阴影）到第一张卡片：几何逐帧追踪真实卡片的当前位置（第一张卡片以纵向中心为锚点，加载中内容变化会让它上下移动，只瞄准起点位置会在落位时跳一下），落位后外壳在真实卡片上方再淡出 160ms 交接，内容层交叉缩放淡入淡出，落位后换成真实卡片（形变期间 `[data-morph]` 隐藏真实卡片）。新挂载的画布在挂载时读取 `screenTransition()` 定下进场类（`enter-self` / `enter-vt` / `enter-hero`）并保持不变；不要再用 `[data-vt]` 属性去关进场动画，否则过渡结束移除属性时动画会从透明重播，整页闪一下。
- 网络与原生能力（可信边界）：
  - 请求经 [`src/core/http.ts`](../src/core/http.ts) 在桌面应用里走 Tauri HTTP 插件，普通浏览器里用原生 fetch（只能跑示例模式）。
  - 网络作用域在 [`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json)：允许所有 `http://*`、`https://*`（研究 Agent 按需读取来源网页全文，用户 2026-10 明确要求放开），拒绝名单列出本机与内网（localhost、127/10/192.168/172.16–31/169.254/0 网段、.local 等）；[`tauri.conf.json`](../src-tauri/tauri.conf.json) 的 `plugins.http.scopeRedirects: true` 让每一跳重定向都过作用域检查（有插件配置时 Rust 侧必须依赖 `serde_json`，否则 `generate_context!` 编译失败）。作用域写法是 URLPattern：IPv6 字面量（如 `http://[::1]`）不是合法模式，会让所有网络请求失败（实测），IPv6 内网改由代码拦截。外链由 opener 插件交给系统浏览器。
  - 网页全文读取 [`providers/web.ts`](../src/core/providers/web.ts)：代码里再查一遍公网地址（含 IPv6 回环 / 唯一本地 / 链路本地），不自动跟随重定向而是逐跳检查，10 秒超时、3MB 上限、只收 HTML / 纯文本，按响应头与 meta 识别编码（GBK 按 GB18030 解码），用 `@mozilla/readability` 提取正文、截到 8000 字。读网页的请求不经调试日志的完整记录（HTML 太大），研究 Agent 只记网址、字数、耗时或失败原因。实测（2026-10）：文章页约 0.5–1 秒；脚本渲染或拒绝访问的页面会失败（如部分 CSDN 页面），失败原因会告诉模型，由它决定换一篇或结束。
  - 内容安全策略（CSP）在 [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json)，新增外部字体、图片或脚本来源时需同步调整。
- 密钥与设置：[`src/settings/store.ts`](../src/settings/store.ts)（zustand persist → 应用 WebView 的 localStorage，明文存于本机应用数据目录，不上传）；控制台日志不得输出密钥。设置页即改即存、没有保存按钮。密钥框用 `type="text"` + CSS 圆点掩码，不用 password 字段，避免 WebView2 弹出保存密码和自带显示按钮。
- 历史记录：[`src/history/`](../src/history/)。每张地图一条记录，存在 WebView 的 IndexedDB（`zds-history`，`meta` 只放列表字段，`maps` 放整张图），不用 localStorage，因为带来源摘要后会超过约 5MB 上限。
  - 自动保存订阅 graph store：节点或视角变化后延迟 800ms 写入；切换地图时立即写完上一张；关窗时 Tauri 会等 `onCloseRequested` 回调写完再关（因此需要 `core:window:allow-destroy` 权限；回调最多等 1.5 秒并吞掉异常，避免窗口关不掉）。
  - 至少有一个完成的回答才入库；只平移缩放不更新「最近修改」时间。打开存档时，保存时仍在进行的节点标为「已中断」并可重试。
  - 删除先从列表移除，5 秒内可撤销，之后才真正删掉。存档格式与转换为纯函数（`snapshot.ts`），有单测。
- 前端状态：[`store/core.ts`](../src/store/core.ts) 是唯一的状态来源与节点基础操作，[`view.ts`](../src/store/view.ts) 管视角与焦点，[`runs.ts`](../src/store/runs.ts) 管请求编排、流式事件写回与取消（回答 / 详解 / 输入框各用自己的键，互不打断；不同节点并行；请求键带地图 id，结果写回发起它的地图），[`graph.ts`](../src/store/graph.ts) 是界面唯一入口（`actions` 与对外读取）；组件只从 graph.ts 引用。树形布局为纯函数 [`src/canvas/layout.ts`](../src/canvas/layout.ts)，节点尺寸由 ResizeObserver 回报后重新布局。布局顶部固定：根节点锚点 `ax/ay` 是左上角，子节点块与父节点顶边对齐向下排，流式输出只向下长；主线（graph store 的 `spineId`，从根到它的路径）拉成水平线：主线上的子节点与父节点顶边对齐，排在它前面的兄弟向上排、后面的向下排，否则越往深处追问越往下滑（用户实测）。主线只在提问时切换（`actions.ask`，含追问、看看新进展，经 `setSpine`），单纯点选浏览不切换；切换时平移那棵树的根锚点，让被点的节点留在原处；打开地图时取最近回答完成的节点，不存档。代价：主线上方还在流式输出的兄弟会向上长。自动移动视角（`.world.glide`）为 600ms，用户实测 420ms 偏快；连线从父节点标题行高度引出。早期存档（`MapRecord.anchor` 缺失）的 ay 是中心，打开时按半个默认卡片高度换算。
- 设计令牌：[`src/styles/tokens.css`](../src/styles/tokens.css) 是颜色、字体、尺寸、动效的唯一入口（含深色模式）。图标统一使用 `lucide-react` 或自绘 SVG；应用图标为「左一右二」三方块交错叠压（左边墨色大块，右上石板灰压住大块，大块压住右下浅石板灰；白底、全中性配色，带渐变、顶部高光和投影的质感，2026-10 用户定稿，明确不要蓝色等彩色块），源文件 `src-tauri/icons/app-icon.svg`，`public/favicon.svg` 是为 32px 单独简化的版本。改后用 `npx tauri icon <svg> -o <临时目录>` 生成，只把 tauri.conf.json 引用的 32x32、128x128、128x128@2x、icon.icns、icon.ico 与 icon.png 拷回 `src-tauri/icons`，不要让 Android / iOS / Windows Store 图标进仓库。

## 运行与验证

- 脚本以 [`package.json`](../package.json) 为准：
  - `npm run dev`：只启动 Vite（:17531），供浏览器里用示例模式调界面；
  - `npm run app:dev`：桌面应用开发模式，会自行启动 Vite，因此不能与 `npm run dev` 同时运行。用真实接口测试时，先在 PowerShell 里执行 `$env:VITE_PROVIDERS = 'real'` 再运行；
  - `npm run app:build`：生成 Windows NSIS 安装包，位于 `src-tauri/target/release/bundle/nsis/`；
  - `npm run typecheck`、`npm test`（`src/**/*.test.ts`，`node:test`）、`npm run build`。
- 依赖：Node、Rust（stable）与 MSVC 构建工具、WebView2（Windows 10/11 自带）。首次 Rust 编译需数分钟；修改 `src-tauri/` 后 `app:dev` 会自动重新编译。
- 配置：`.env` 只有可选的 `VITE_PROVIDERS=mock`（见 `.env.example`）；进程环境变量优先于 `.env`，桌面开发时可用 `VITE_PROVIDERS=real npm run app:dev` 走真实接口。
- 最低验证：`npm run typecheck` 与 `npm test`。界面改动在浏览器示例模式走通「首页提问 → 加载 → 答案 → 延伸问题 → 多选指令 → 综合节点 → 详情抽屉 → 总结面板 → 设置 → 回首页看最近 → 历史面板搜索、打开、删除与撤销」。
- WebView 的 localStorage 与 IndexedDB 按来源（含端口）隔离：开发版换端口后设置里的 Key 和历史记录都看不到，所以开发版固定用 17531（`devUrl`，选不常见端口是为了避开其他项目；2026-10 从 5173 改过来，Key 需重新填，之前的历史记录留在 5173 来源下看不到）；17531 被占用时要先让出端口，而不是改端口启动。
- 桌面应用 `app:dev` 运行时会占用 17531 端口和 WebView2 数据目录：浏览器示例模式改用 `.claude/launch.json` 的 `dev-mock`（17532 端口）；也不能再启动第二个带调试端口的应用实例（WebView2 报 0x8007139F）。高分屏细节截图可用无头 Edge（`--headless=new --force-device-scale-factor=1.5 --disable-sync --disable-extensions`，独立的 `--user-data-dir`）加 CDP。
- 调试日志（仅开发版桌面应用）：[`src/core/debug.ts`](../src/core/debug.ts) 经 Rust `debug_log` 命令，把每次运行写入 `.debug/network.jsonl`（每行一条 JSON，启动时上一份改名为 `network.prev.jsonl`）。内容包括：
  - `run.start`：请求参数；
  - `http.request` / `http.response`：完整请求体与提示词、状态、首包与总耗时、原始响应，流式响应另拼出 `content` / `reasoning`；
  - `run.done` / `run.error`：解析后的结论、要点、追问与原始错误。
  密钥只留首 6 位与末 4 位，发布版不编译该命令。排查真实请求问题时先读这份日志。
- 存储隔离：Claude 桌面应用是 MSIX 打包的，从 Claude 工具（Bash / PowerShell）启动的进程，写入 `AppData\Local` 会被重定向到 `Packages\Claude_…\LocalCache`；用户终端标签页启动的应用使用真实路径。两边的设置与 Key 互不可见。需要用户已保存的 Key 做验证时，要在用户的终端标签页里启动应用（可临时加调试端口），不要从工具里启动。
- 网络或原生改动必须在桌面窗口里验证：设环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` 启动应用，通过 CDP 在窗口内执行请求。
- 开发服务：`.claude/launch.json` 的 `dev` 配置运行 `npm run dev`，`dev-mock` 在 17532 端口运行示例模式（就绪信号为 Vite `ready`）；停止时只结束该命令或核对过 PID 的进程。
- 费用与权限：真实模式每次提问会调用付费的元宝搜索与 TokenHub 模型。验证优先用示例模式或无效密钥；真实调用只用用户提供的密钥，并控制次数。

## 环境与协作例外

- 当前目录不是 Git 仓库，按 Git 规则跳过提交与同步，不自行初始化仓库。
