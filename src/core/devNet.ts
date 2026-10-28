import type { HttpFetch } from "./providers/types.ts";

// 开发时浏览器里的网络（只给开发工作用，不对用户发布；桌面应用与发布版都不经过这里）：
// 腾讯接口不允许浏览器跨域，请求交给 Vite 开发服务器转发（vite.config.ts 的 /__zds/net）。

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
