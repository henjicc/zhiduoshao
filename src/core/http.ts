import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { HttpFetch } from "./providers/types.ts";

/**
 * 腾讯的接口不允许浏览器跨域调用，桌面应用里由 Tauri HTTP 插件在本机发出请求，
 * 可访问的域名在 src-tauri/capabilities/default.json 中白名单限定。
 * 在普通浏览器里只能使用示例模式。
 */
export const IN_APP = isTauri();

export const httpFetch: HttpFetch = (input, init) => (IN_APP ? tauriFetch(input, init) : fetch(input, init));
