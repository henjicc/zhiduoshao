import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "../core/http.ts";
import { toast } from "../store/toast.ts";

// 导出与复制 Markdown：桌面应用里经 Rust 的 save_markdown 弹出「另存为」；浏览器（示例模式）里直接下载。

export async function saveMarkdown(name: string, content: string) {
  try {
    if (IN_APP) {
      if (await invoke<boolean>("save_markdown", { name, content })) toast("已导出 Markdown");
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    console.error("[export] 导出失败", e);
    toast("导出失败，请重试");
  }
}

export async function copyText(text: string, done = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (e) {
    console.error("[export] 复制失败", e);
    toast("复制失败，请重试");
  }
}
