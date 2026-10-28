import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 痕迹AI 的录制探针包尚未发布到 npm，暂时直接引用本机痕迹仓库里的源码（tsconfig.json 的 paths 同步）；发布后改为 npm 依赖并删掉这里
const probeDir = fileURLToPath(new URL("../Henji-AI-webreplay/packages/web-replay-probe/src", import.meta.url));

// 同时服务于浏览器开发（示例模式）与 Tauri 桌面应用（tauri dev 会连接这个端口）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { "@henjicc/web-replay-probe": `${probeDir}/index.ts` } },
  server: {
    port: 17531,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    fs: { allow: [".", probeDir] },
  },
  build: { target: "es2022" },
});
