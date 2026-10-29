import { isTauri } from "@tauri-apps/api/core";
import { firstDifference, packBody, parsePackMode, PACK_FORMAT, PACK_VERSION, requestKey, safeHeaders, schedule, scrubSecrets, secretsOf, type Pack, type PackCall, type PackMode, type Pace } from "./pack.ts";
import type { HttpFetch } from "./providers/types.ts";

// 开发时浏览器里的网络（只给开发与演示录制用，不对用户发布；桌面应用与发布版都不经过这里）：
// - 腾讯接口不允许浏览器跨域，请求交给 Vite 开发服务器转发（vite.config.ts 的 /__zds/net）；
// - 地址带 ?capture=名字 时把每次外部调用的原始返回存成数据包（同名已存在时接着记），?replay=名字 时从数据包放回、不联网。
//   数据包经开发服务器读写（/__zds/pack/名字），格式见 pack.ts。

/** 当前的数据包模式；地址参数写错时直接报错，不悄悄按普通模式运行 */
export const PACK_MODE: PackMode | null = import.meta.env.DEV && !isTauri() ? parsePackMode(location.search) : null;

/** 转发响应里放不进正文的状态码（这些状态不能带正文） */
const NULL_BODY = new Set([101, 204, 205, 304]);

/** 经开发服务器转发：真实状态码与响应头放在 x-zds-* 头里，转发本身总是 200（否则浏览器会自己跟随重定向） */
export const devFetch: HttpFetch = async (url, init) => {
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new Error("开发转发只支持文本请求体");
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  // 展开调用方的 init：痕迹探针在里面放了标记，它对 window.fetch 的监听据此不再重复录这一次
  const res = await fetch("/__zds/net", {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: init.method ?? "GET", headers, body: init.body ?? undefined }),
    redirect: "follow",
  });
  if (!res.ok) {
    const err = res.headers.get("x-zds-error");
    // 和桌面里请求没送达一样抛出，供应商按网络错误处理
    throw new TypeError(err ? decodeURIComponent(err) : `开发服务器转发失败（HTTP ${res.status}）`);
  }
  const status = Number(res.headers.get("x-zds-status"));
  const upHeaders = JSON.parse(decodeURIComponent(res.headers.get("x-zds-headers") ?? "%7B%7D")) as Record<string, string>;
  return new Response(NULL_BODY.has(status) ? null : res.body, { status, headers: upHeaders });
};

declare global {
  interface Window {
    /** 自动化脚本用：采集时等数据包写完，重放时查看用了几条、有没有对不上 */
    __zdsPack?: { mode: PackMode["kind"]; name: string; flush?: () => Promise<number>; status?: () => { total: number; used: number; missing: number } };
  }
}

/** 按数据包模式包一层；没有数据包模式时原样返回 */
export function withPack(base: HttpFetch): HttpFetch {
  if (!PACK_MODE) return base;
  return PACK_MODE.kind === "capture" ? capture(PACK_MODE.name, base) : replay(PACK_MODE.name, PACK_MODE.pace);
}

const packUrl = (name: string) => `/__zds/pack/${encodeURIComponent(name)}`;

// ---- 采集 ----

function capture(name: string, base: HttpFetch): HttpFetch {
  const pack: Pack = { format: PACK_FORMAT, version: PACK_VERSION, name, createdAt: new Date().toISOString(), calls: [] };
  const secrets = new Set<string>();
  /** 还没结束的调用（包括还没收到响应头的） */
  const open = new Set<Promise<unknown>>();
  const t0 = performance.now();
  let dirty = false;
  let saveError: unknown = null;
  /** 接着已有数据包记时，新调用的发出时刻排在已有调用之后 */
  let atShift = 0;
  let resumeFailed = false;

  // 同名数据包已存在（页面刷新、热更新整页重载、接着上次采集）时接在后面记，不覆盖已经录下的调用；
  // 要从头重采就先删掉文件或换个名字
  const resumed = fetch(packUrl(name), { method: "GET" }).then(async (res) => {
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`读取已有数据包失败（HTTP ${res.status}）`);
    const old = (await res.json()) as Pack;
    if (old.format !== PACK_FORMAT || old.version > PACK_VERSION) throw new Error(`「${name}」已存在，但不是这个版本能续写的数据包`);
    atShift = Math.max(0, ...old.calls.map((c) => c.at + (c.ms ?? c.errorMs ?? 0))) + 1000;
    for (const c of pack.calls) c.at += atShift;
    pack.calls.unshift(...old.calls);
    pack.createdAt = old.createdAt;
    console.info(`[数据包] 「${name}」已有 ${old.calls.length} 次调用，接着记`);
  }).catch((err) => {
    resumeFailed = true;
    saveError = err;
    console.error("[数据包] 读取已有数据包失败", err);
    showProblem(`数据包「${name}」已存在但读不出来，这次采集不会写入，详见控制台。`);
  });
  // 读完已有内容之前不写，免得先把只有新调用的半份写回去
  let saving: Promise<void> = resumed;

  // 每次调用结束都整份写一遍；写入串行，写的时候又有变化就再写一次
  const save = () => {
    dirty = true;
    saving = saving.then(async () => {
      if (!dirty || resumeFailed) return;
      dirty = false;
      const res = await fetch(packUrl(name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: scrubSecrets(JSON.stringify(pack), secrets) });
      if (!res.ok) throw new Error(`数据包写入失败（HTTP ${res.status}）：${await res.text()}`);
      saveError = null;
    }).catch((err) => {
      saveError = err;
      console.error("[数据包] 写入失败", err);
      showProblem(`数据包「${name}」写入失败，详见控制台。`);
    });
    return saving;
  };

  /** 请求失败或读到一半中断：记下原因、时刻，以及是不是调用方自己取消的（重放时照样等调用方取消） */
  const failed = (call: PackCall, err: unknown, started: number, signal?: AbortSignal | null) => {
    call.error = errorText(err);
    call.errorMs = Math.round(performance.now() - started);
    if (signal?.aborted) call.aborted = true;
  };

  async function record(call: PackCall, res: Response, started: number) {
    const type = res.headers.get("content-type") ?? "";
    const utf8 = /event-stream|json/i.test(type);
    const r = { status: res.status, headers: safeHeaders(res.headers), firstByteMs: Math.round(performance.now() - started), encoding: utf8 ? "utf8" : "base64", chunks: [] } as NonNullable<PackCall["response"]>;
    call.response = r;
    if (!res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      const t = Math.round(performance.now() - started);
      if (done) {
        const tail = utf8 ? dec.decode() : "";
        if (tail) r.chunks.push([t, tail]);
        return;
      }
      r.chunks.push([t, utf8 ? dec.decode(value, { stream: true }) : toBase64(value)]);
    }
  }

  const fetchFn: HttpFetch = (url, init) => {
    const started = performance.now();
    const call: PackCall = { at: Math.round(started - t0) + atShift, method: (init.method ?? "GET").toUpperCase(), url, headers: safeHeaders(init.headers), body: packBody(init.body) };
    for (const s of secretsOf(init.headers)) secrets.add(s);
    pack.calls.push(call);
    const sent = base(url, init);
    // 复制一份响应边读边记，原样交给调用方；读完、失败或中途取消后再写数据包
    const job = sent
      .then((res) => record(call, res.clone(), started))
      .then(() => { call.ms = Math.round(performance.now() - started); })
      .catch((err) => failed(call, err, started, init.signal))
      .finally(() => { open.delete(job); void save(); });
    open.add(job);
    return sent;
  };

  window.__zdsPack = {
    mode: "capture",
    name,
    flush: async () => {
      while (open.size) await Promise.all([...open]);
      await save();
      if (saveError) throw saveError;
      return pack.calls.length;
    },
  };
  console.info(`[数据包] 采集中：${name}`);
  return fetchFn;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- 重放 ----

function replay(name: string, pace: Pace): HttpFetch {
  // 第一次请求时才读数据包：痕迹重演时请求由探针直接给出，不会走到这里，也就不需要开发服务器
  let loading: Promise<{ calls: PackCall[]; byKey: Map<string, number[]> }> | null = null;
  const used = new Set<number>();
  let total = 0;
  let missing = 0;

  // init 是触发读取的那次请求的：展开它带上痕迹探针的标记，痕迹录制时不把读数据包录成一次调用
  const load = (init: RequestInit) => (loading ??= (async () => {
    const res = await fetch(packUrl(name), { ...init, method: "GET", headers: undefined, body: undefined, signal: undefined, redirect: "follow" });
    if (!res.ok) throw new Error(res.status === 404 ? `没有数据包「${name}」` : `读取数据包「${name}」失败（HTTP ${res.status}）`);
    const pack = (await res.json()) as Pack;
    if (pack.format !== PACK_FORMAT || pack.version > PACK_VERSION) throw new Error(`「${name}」不是这个版本能读的数据包`);
    const byKey = new Map<string, number[]>();
    pack.calls.forEach((c, i) => {
      const k = requestKey(c.method, c.url, c.body);
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
    });
    total = pack.calls.length;
    console.info(`[数据包] 重放：${name}，共 ${total} 次调用`);
    return { calls: pack.calls, byKey };
  })());

  window.__zdsPack = { mode: "replay", name, status: () => ({ total, used: used.size, missing }) };

  return async (url, init) => {
    const started = performance.now();
    let pack: Awaited<ReturnType<typeof load>>;
    try {
      pack = await load(init);
    } catch (err) {
      missing++;
      console.error("[数据包]", err);
      showProblem(String((err as Error).message ?? err));
      throw err;
    }
    const method = (init.method ?? "GET").toUpperCase();
    const key = requestKey(method, url, packBody(init.body));
    // 同样的请求出现多次时按顺序取
    const i = pack.byKey.get(key)?.find((x) => !used.has(x));
    if (i === undefined) {
      missing++;
      reportMissing(name, method, url, key, pack.calls, used);
      throw new TypeError(`数据包「${name}」里没有这次请求：${method} ${url}`);
    }
    used.add(i);
    const call = pack.calls[i];
    if (call.ms === undefined && call.error === undefined) {
      missing++;
      console.error(`[数据包] 「${name}」里这次请求采集时没有录完：${method} ${url}`);
      showProblem(`数据包「${name}」里这次请求采集时没有录完，需要重新采集：${method} ${url}`);
      throw new TypeError(`数据包「${name}」里这次请求采集时没有录完`);
    }
    return respond(call, pace, started, init.signal ?? undefined);
  };
}

const abortReason = (signal: AbortSignal) => signal.reason ?? new DOMException("Aborted", "AbortError");

/** 等到某个时刻；t 为 Infinity 时一直等到调用方取消 */
const sleepUntil = (t: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  let timer = 0;
  const abort = () => { clearTimeout(timer); reject(abortReason(signal!)); };
  if (signal?.aborted) return abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (t !== Infinity) timer = window.setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(0, t - performance.now()));
});

/**
 * 按时间表放出录下来的结果：先等到响应头的时刻，正文按块定时写进流。
 * 采集时失败的在同一时刻照样失败；被调用方取消的（超时、用户取消）不自己结束，等这次的调用方取消，
 * 这样研究决策超时、读网页超时都和采集时走同一条路
 */
async function respond(call: PackCall, pace: Pace, started: number, signal?: AbortSignal) {
  const plan = schedule(call, pace);
  const end = async () => {
    await sleepUntil(call.aborted ? Infinity : started + plan.failAt, signal);
    throw new TypeError(call.error);
  };
  const r = call.response;
  if (!r) return end();
  await sleepUntil(started + plan.headersAt, signal);
  const enc = new TextEncoder();
  const body = NULL_BODY.has(r.status) ? null : new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        for (const [t, chunk] of plan.chunks) {
          await sleepUntil(started + t, signal);
          ctrl.enqueue(r.encoding === "utf8" ? enc.encode(chunk) : fromBase64(chunk));
        }
        if (call.error) await end();
        ctrl.close();
      } catch (err) {
        ctrl.error(err);
      }
    },
  });
  return new Response(body, { status: r.status, headers: r.headers });
}

/** 对不上时在控制台写清是哪次请求、和最接近的那条差在哪 */
function reportMissing(name: string, method: string, url: string, key: string, calls: PackCall[], used: Set<number>) {
  const same = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.method === method && c.url === url);
  const near = same.filter(({ i }) => !used.has(i)).map(({ c, i }) => ({ i, d: firstDifference(key, requestKey(c.method, c.url, c.body)) })).sort((a, b) => b.d.at - a.d.at)[0];
  console.error(`[数据包] 「${name}」里没有这次请求：${method} ${url}`, {
    同网址的调用: same.length,
    其中还没用过: same.filter(({ i }) => !used.has(i)).length,
    最接近的一条: near ? { 序号: near.i, 从第几个字符开始不同: near.d.at, 这次: near.d.mine, 数据包: near.d.theirs } : null,
  });
  showProblem(`数据包「${name}」里没有这次请求：${method} ${url}。详见控制台。`);
}

/** 页面上的错误条：数据包出问题时这一遍录制不能用，必须一眼看到 */
function showProblem(text: string) {
  let box = document.getElementById("zds-pack-problem");
  if (!box) {
    box = document.createElement("div");
    box.id = "zds-pack-problem";
    box.setAttribute("role", "alert");
    Object.assign(box.style, {
      position: "fixed", left: "16px", right: "16px", bottom: "16px", zIndex: "2147483647", padding: "10px 14px",
      borderRadius: "var(--r-md)", background: "var(--danger-solid)", color: "var(--on-solid)", font: "500 var(--fs-md)/1.6 var(--font-ui)",
      boxShadow: "var(--shadow-3)", whiteSpace: "pre-wrap",
    });
    document.body.append(box);
  }
  box.textContent = box.textContent ? `${box.textContent}\n${text}` : text;
}
