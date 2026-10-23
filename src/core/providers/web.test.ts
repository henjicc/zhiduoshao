import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicUrl, MAX_PAGE_CHARS, sniffCharset, tidyText } from "./web.ts";

test("只允许公网 http/https：本机、内网、链路本地与非网页协议一律拒绝", () => {
  for (const ok of ["https://www.gmw.cn/a.html", "http://news.qq.com/x?y=1", "https://8.8.8.8/", "https://172.32.0.1/"]) assert.equal(isPublicUrl(ok), true, ok);
  for (const bad of [
    "http://localhost:5173/", "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.1.1/", "http://172.16.0.1/", "http://172.31.255.1/",
    "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/",
    "http://printer.local/", "http://intranet/", "file:///C:/Windows/win.ini", "ftp://a.com/", "https://user:pw@a.com/", "不是网址",
  ]) assert.equal(isPublicUrl(bad), false, bad);
});

test("网页编码：响应头优先，其次 meta；GBK / GB2312 按 GB18030 解码", () => {
  assert.equal(sniffCharset("text/html; charset=GBK", ""), "gb18030");
  assert.equal(sniffCharset("text/html", '<meta charset="gb2312">'), "gb18030");
  assert.equal(sniffCharset(null, '<meta http-equiv="Content-Type" content="text/html; charset=big5">'), "big5");
  assert.equal(sniffCharset("text/html", "<html>"), "utf-8");
});

test("正文整理：合并空白、保留段落、超长截断", () => {
  assert.equal(tidyText("  第一段\n  续行 \n\n\n 第二段\t结尾  "), "第一段 续行\n第二段 结尾");
  const long = tidyText("字".repeat(MAX_PAGE_CHARS + 50));
  assert.equal(long.length, MAX_PAGE_CHARS + 1);
  assert.ok(long.endsWith("…"));
});
