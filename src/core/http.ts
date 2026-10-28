import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { wrapFetch } from "@henjicc/web-replay-probe";
import { devFetch, withPack } from "./devNet.ts";
import type { HttpFetch } from "./providers/types.ts";

/**
 * 腾讯的接口不允许浏览器跨域调用，桌面应用里由 Tauri HTTP 插件在本机发出请求，
 * 可访问的域名在 src-tauri/capabilities/default.json 中白名单限定。
 */
export const IN_APP = isTauri();

/** 开发时在普通浏览器里：请求经 Vite 开发服务器转发，并可采集或重放数据包（devNet.ts）。发布版里恒为 false */
const DEV_BROWSER = import.meta.env.DEV && !IN_APP;

/** 能发出真实请求：桌面应用，或开发时的浏览器；发布版在普通浏览器里不能 */
export const CAN_FETCH = IN_APP || DEV_BROWSER;

const browserFetch: HttpFetch = DEV_BROWSER ? withPack(devFetch) : (input, init) => fetch(input, init);

/**
 * 应用唯一的网络出口。外层交给痕迹的录制探针包装：痕迹录制时照常发出并复制一份请求与流式返回，
 * 重演时直接给出录制结果；平时原样透传。外部接口不要绕过它。
 */
export const httpFetch: HttpFetch = wrapFetch((input, init) => (IN_APP ? tauriFetch(input, init) : browserFetch(input, init)));
