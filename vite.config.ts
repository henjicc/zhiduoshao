import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 同时服务于浏览器开发（示例模式）与 Tauri 桌面应用（tauri dev 会连接这个端口）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 17531,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022" },
});
