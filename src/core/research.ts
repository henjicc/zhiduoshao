import { runAgent, type AgentDeps, type AgentSpec, type Outcome } from "./agent.ts";
import { readObservation, researchObservation, researchPrompt } from "./prompts.ts";
import { articleKeys, DROP_WHY, fullTextIssue, queryKey, SOURCES_CAP, type DropWhy, type Industry, type SearchPlan, type Source, type StreamEvent } from "./protocol.ts";
import { ProviderError, type SearchProvider } from "./providers/types.ts";
import type { PageReader } from "./providers/web.ts";

// 研究 Agent：规划检索 → 搜索 → 复查，资料不够就换词再搜，摘要不够深时读几篇全文。跑在 agent.ts 的内核上，动作：
//   {"action":"search","queries":[{"q":"...","time":"m1","field":"news"}],"sources":N,"missing":"还缺什么"}
//   {"action":"read","ids":[3,7],"reason":"为什么要读全文"}
//   {"action":"done","drop":[{"id":4,"why":"离题"}]}（drop 可省：不交给写答案的来源及理由，理由为离题、内容农场、软文或重复；也接受只写序号）
// 整个循环是同一段对话：模型看得到前面的规划、每轮拿到了什么、读了哪些全文、上一轮认为还缺什么。

export interface ResearchDeps extends AgentDeps {
  /** 未配置搜索时为 null，联网请求会报错而不是静默降级 */
  search: SearchProvider | null;
  /** 读取来源网页全文；没有时 read 动作不可用 */
  reader?: PageReader | null;
}

/** 来源数量由模型按问题决定；超出范围时收回到边界 */
export const SOURCES_MIN = 5;
export const SOURCES_MAX = 20;
const SOURCES_DEFAULT = 10;
/** 首轮每个查询词至少留几条：模型拆了多个方面，来源总数也应随之增加，否则多搜的词会被截掉 */
const PER_QUERY_MIN = 4;
const MAX_QUERIES = 4;
/** 补搜：每轮最多几个查询词、新增几条来源；连首轮最多几轮、总时长多久 */
const EXTRA_QUERIES = 2;
const EXTRA_PER_ROUND = 6;
const MAX_ROUNDS = 3;
/** 读全文：每次最多几篇、整个研究最多几篇；读网页每篇要几秒，只在摘要不够深时用 */
const READ_PER_ACTION = 3;
const READ_MAX = 4;
/** 决策步数与总时长上限：搜索最多 3 轮，再留出读全文与收尾的步数 */
const MAX_STEPS = 6;
const RESEARCH_MS = 45_000;
const INDUSTRIES: Industry[] = ["gov", "news", "acad", "finance"];
const FRESHNESS = /^(d([1-9]|[12]\d|30)|m([1-9]|1[0-2])|y[1-5])$/;

const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
const SUFFIX_ONLY = /^(gov|com|edu|org|net|ac)\.[a-z]{2}$/;

/** quick：模型判断为一轮搜索就能答的简单问题（单一事实、实时数据），搜到结果后不再复查，回答也不开思考；
 * missing：补充检索时模型写的「还缺什么」，显示在检索过程里 */
export interface Plan { queries: SearchPlan[]; sources: number; quick?: boolean; missing?: string }

/** 限定站点：只收一个域名，去掉协议、路径与端口；不合法时丢弃（照常全网搜） */
function parseSite(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  // gov.cn、com.cn 这类只有后缀的写法实测（2026-10）返回 0 条，当作不限站点
  return DOMAIN.test(d) && !SUFFIX_ONLY.test(d) ? d : undefined;
}

/** 查询词列表：单条也接受纯字符串；查询词里写了「site:域名」的也拆成限定站点；按「查询词 + 站点」去重、跳过搜过的；
 * 不合法的时间范围、领域与站点直接丢弃 */
function parseQueries(items: unknown[], done: Set<string>): SearchPlan[] {
  const queries: SearchPlan[] = [];
  for (const item of items) {
    const o = (typeof item === "string" ? { q: item } : item) as { q?: unknown; time?: unknown; field?: unknown; site?: unknown } | null;
    let q = typeof o?.q === "string" ? o.q.trim() : "";
    let site = parseSite(o?.site);
    const inline = q.match(/\s*\bsite:(\S+)/i);
    if (inline) {
      q = q.replace(inline[0], "").trim();
      site ??= parseSite(inline[1]);
    }
    if (!q) continue;
    const plan: SearchPlan = site ? { q, site } : { q };
    const key = queryKey(plan);
    if (done.has(key) || queries.some((x) => queryKey(x) === key)) continue;
    if (typeof o!.time === "string" && FRESHNESS.test(o!.time)) plan.freshness = o!.time;
    if (INDUSTRIES.includes(o!.field as Industry)) plan.industry = o!.field as Industry;
    queries.push(plan);
  }
  return queries;
}

/**
 * search 动作的参数。首轮按模型给的总数取来源（收回到 5–20，且每个查询词至少 4 条）；
 * 补搜每轮最多 2 个新词、新增 6 条。没有可用的新查询词时返回 null。
 */
export function parseSearch(input: Record<string, unknown>, searched: string[], first: boolean): Plan | null {
  if (!Array.isArray(input.queries)) return null;
  const queries = parseQueries(input.queries, new Set(searched)).slice(0, first ? MAX_QUERIES : EXTRA_QUERIES);
  if (!queries.length) return null;
  // 首轮全部限定了站点时，留一个全网查询兜底：限定的站点可能收录很少或搜不到
  if (first && queries.every((p) => p.site)) {
    const { site: _, ...open } = queries[0];
    if (queries.length < MAX_QUERIES && !queries.some((p) => queryKey(p) === open.q)) queries.push(open);
    else delete queries[queries.length - 1].site;
  }
  if (!first) {
    const missing = typeof input.missing === "string" ? input.missing.trim().slice(0, 60) : "";
    return missing ? { queries, sources: EXTRA_PER_ROUND, missing } : { queries, sources: EXTRA_PER_ROUND };
  }
  const n = Number(input.sources);
  const want = Number.isFinite(n) ? n : SOURCES_DEFAULT;
  const sources = Math.round(Math.min(SOURCES_MAX, Math.max(SOURCES_MIN, want, queries.length * PER_QUERY_MIN)));
  return input.quick === true ? { queries, sources, quick: true } : { queries, sources };
}

/** 每个查询取多少条：总量按查询数平分并留出去重余量，取元宝支持的档位（10 到 50） */
export const perQuery = (limit: number, queries: number) => Math.min(50, Math.max(10, Math.ceil((limit * 1.5) / queries / 10) * 10));

/** 去重：任何一个键见过（或在 exclude 里）就算重复 */
function dedupe(exclude: Set<string>) {
  const seen = new Set(exclude);
  return (s: Source) => {
    const keys = articleKeys(s);
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  };
}

/** 并行检索，交错合并多个查询的结果并去重，保证每个查询的头部结果都能入选；exclude 为已有来源的键（见 articleKeys）。
 * results 为去重前的总条数，unique 为其中不重复、也不是已有来源的条数，hits 为每个查询各返回几条（限定站点的查询可能为 0，要告诉模型） */
async function searchAll(deps: ResearchDeps, plan: Plan, signal: AbortSignal, exclude: Set<string>): Promise<{ fresh: Source[]; results: number; unique: number; hits: number[] }> {
  if (!deps.search) throw new ProviderError("yuanbao", "尚未填写元宝搜索 API Key", undefined, "config");
  const count = perQuery(plan.sources, plan.queries.length);
  const lists = await Promise.all(plan.queries.map((p) => deps.search!.search(p.q, { count, freshness: p.freshness, industry: p.industry, site: p.site, signal })));
  const out: Source[] = [];
  const take = dedupe(exclude);
  for (let i = 0; out.length < plan.sources && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const s = l[i];
      if (s && out.length < plan.sources && take(s)) out.push(s);
    }
  }
  const unique = lists.flat().filter(dedupe(exclude)).length;
  return { fresh: out, results: lists.reduce((sum, l) => sum + l.length, 0), unique, hits: lists.map((l) => l.length) };
}

/** read 动作的参数：来源序号（1 起），只收没读过、在范围内的，每次最多 3 篇；一篇都不可用时返回 null */
export function parseRead(input: Record<string, unknown>, sources: Source[], left: number): number[] | null {
  if (!Array.isArray(input.ids) || left <= 0) return null;
  const ids: number[] = [];
  for (const v of input.ids) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > sources.length || ids.includes(n)) continue;
    const s = sources[n - 1];
    if (s.text || !s.url) continue;
    ids.push(n);
  }
  return ids.length ? ids.slice(0, Math.min(READ_PER_ACTION, left)) : null;
}

/** done 动作的 drop：复查判定不交给写答案的来源序号与理由，每项是 {"id":序号,"why":理由}，也接受只写序号（不显示理由）。
 * 已有来源（前 known 条）的序号不能变，不能丢；要把来源全部丢掉时写答案就没有材料了，按判断有误处理，一条不丢 */
export function parseDrop(input: Record<string, unknown>, total: number, known: number): Map<number, DropWhy | undefined> {
  const drop = new Map<number, DropWhy | undefined>();
  for (const item of Array.isArray(input.drop) ? input.drop : []) {
    const o = (item && typeof item === "object" ? item : { id: item }) as { id?: unknown; why?: unknown };
    const n = Number(o.id);
    if (!Number.isInteger(n) || n <= known || n > total || drop.has(n)) continue;
    drop.set(n, DROP_WHY.find((w) => w === o.why));
  }
  return drop.size < total ? drop : new Map();
}

/**
 * 为问题检索资料，返回交给写答案的来源（复查用 drop 剔除的不在其中）。known 是已有来源（搜索更多来源、综合节点），新来源接在它们后面、保持原序号；
 * searched 是已搜过的查询词，补充检索时避开。
 */
export async function* research(
  deps: ResearchDeps, question: string, path: { q: string }[], signal: AbortSignal,
  opts: { note?: string; images?: string[]; known?: Source[]; searched?: string[]; freshness?: string; exclude?: string[]; official?: boolean; memory?: string } = {},
): AsyncGenerator<StreamEvent, { sources: Source[]; quick: boolean }> {
  const known = opts.known ?? [];
  const searched = [...(opts.searched ?? [])];
  let sources = known;
  let rounds = 0;
  let reads = 0;
  let quick = false;
  // 首轮搜索时按模型给的来源数定上限；已有来源（综合节点合并来的可能更多）一条都不丢
  let cap = SOURCES_CAP;
  const canSearch = () => rounds < MAX_ROUNDS && sources.length < cap;
  const canRead = () => !!deps.reader && reads < READ_MAX;
  /** 每次观察的结尾提示还能做什么，模型不用自己数次数 */
  const options = () => [
    canSearch() ? "还可以继续搜索" : "搜索次数或来源数已到上限，不能再搜索",
    canRead() ? `还可以读 ${READ_MAX - reads} 篇全文` : "不能再读全文",
  ].join("；");

  async function* search(plan: Plan): AsyncGenerator<StreamEvent, Outcome<Source[]>> {
    rounds++;
    if (rounds === 1) cap = Math.max(known.length, Math.min(SOURCES_CAP, known.length + plan.sources + EXTRA_PER_ROUND * (MAX_ROUNDS - 1)));
    const queries = plan.queries.map(queryKey);
    yield { type: "stage", stage: "search", detail: { queries, round: rounds } };
    // 看看新进展或用户选了时间范围：由程序统一限定，模型给的不算；上一层已有的来源不算新内容
    const run = opts.freshness ? { ...plan, queries: plan.queries.map((p) => ({ ...p, freshness: opts.freshness })) } : plan;
    const started = Date.now();
    const { fresh, results, unique, hits } = await searchAll(deps, run, signal, new Set([...(opts.exclude ?? []), ...sources.flatMap(articleKeys)]));
    yield { type: "searched", results, unique, plans: run.queries.map((p, i) => ({ ...p, hits: hits[i], round: rounds })), ms: Date.now() - started, ...(plan.missing ? { reason: plan.missing } : {}) };
    const offset = sources.length;
    sources = [...sources, ...fresh].slice(0, cap);
    searched.push(...queries);
    yield { type: "sources", sources };
    // 简单问题：首轮搜到结果就结束，省掉复查这一步
    if (rounds === 1 && plan.quick && fresh.length) {
      quick = true;
      return { finish: sources };
    }
    const perQueryHits = queries.map((q, i) => ({ q, n: hits[i] }));
    return { observe: `${researchObservation(rounds, sources.slice(offset), offset, sources.length, perQueryHits)}\n（${options()}）` };
  }

  async function* read(ids: number[]): AsyncGenerator<StreamEvent, Outcome<Source[]>> {
    reads += ids.length;
    yield { type: "stage", stage: "fetch", detail: { count: ids.length, titles: ids.map((n) => sources[n - 1].title) } };
    const results = await Promise.all(ids.map(async (n) => {
      const s = sources[n - 1];
      const started = Date.now();
      try {
        const page = await deps.reader!.read(s.url, signal);
        const issue = fullTextIssue(s, page.text);
        deps.log(`research: read [${n}] ${page.text.length} chars in ${Date.now() - started}ms${issue ? ", shorter than snippet" : ""}`, s.url);
        return issue ? { n, error: issue } : { n, text: page.text };
      } catch (err) {
        if (signal.aborted) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        deps.log(`research: read [${n}] failed: ${reason}`, s.url);
        return { n, error: reason };
      }
    }));
    const got = new Map(results.filter((r) => r.text).map((r) => [r.n, r.text!]));
    yield { type: "read", titles: ids.map((n) => sources[n - 1].title), ok: got.size };
    if (got.size) {
      sources = sources.map((s, i) => (got.has(i + 1) ? { ...s, text: got.get(i + 1) } : s));
      yield { type: "sources", sources };
    }
    return { observe: `${readObservation(results.map((r) => ({ n: r.n, title: sources[r.n - 1].title, text: r.text, error: r.error })))}\n（${options()}）` };
  }

  async function* finish(drop: Map<number, DropWhy | undefined>): AsyncGenerator<StreamEvent, Outcome<Source[]>> {
    if (drop.size) {
      yield {
        type: "dropped",
        sources: [...drop].map(([n, why]) => {
          const { id, title, site, url, favicon } = sources[n - 1];
          return { id, title, site, url, ...(favicon ? { favicon } : {}), ...(why ? { why } : {}) };
        }),
      };
      sources = sources.filter((_, i) => !drop.has(i + 1));
      yield { type: "sources", sources };
    }
    return { finish: sources };
  }

  const spec: AgentSpec<Source[]> = {
    name: "research",
    messages: researchPrompt(question, path, opts.note, searched, !!deps.reader, opts.official, opts.memory, opts.images),
    actions: {
      search: {
        parse: (input) => (canSearch() ? parseSearch(input, searched, rounds === 0) : null),
        run: (plan: Plan) => search(plan),
      },
      read: {
        parse: (input) => (rounds > 0 && canRead() ? parseRead(input, sources, READ_MAX - reads) : null),
        run: (ids: number[]) => read(ids),
      },
      done: {
        parse: (input) => parseDrop(input, sources.length, known.length),
        // 一次都还没搜就说够了：联网模式下仍按原问题搜一轮，答案至少有来源可依
        run: (drop: Map<number, DropWhy | undefined>) => (rounds === 0 ? search({ queries: [{ q: question }], sources: SOURCES_DEFAULT }) : finish(drop)),
      },
    },
    budget: { maxSteps: MAX_STEPS, maxMs: RESEARCH_MS },
    // 输出不可用时结束：还没搜过就由 done 按原问题搜一轮（检索词不够精炼，但仍有有效结果），搜过了就到此为止
    fallback: () => ({ action: "done" }),
    exhausted: () => sources,
    beforeStep: (step) => (step === 1 ? { type: "stage", stage: "rewrite" } : { type: "stage", stage: "review", detail: { count: sources.length, round: rounds } }),
  };
  return { sources: yield* runAgent(deps, spec, signal), quick };
}
