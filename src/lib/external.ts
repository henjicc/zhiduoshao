// 用系统默认浏览器打开外链：opener 插件会接管带 target="_blank" 的链接点击（桌面应用里），浏览器开发时就是新标签页
export function openExternal(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.append(a);
  a.click();
  a.remove();
}
