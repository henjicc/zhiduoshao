// 痕迹AI 网页录制探针：必须是 main.tsx 的第一条 import（zustand 持久化在导入期就读存储）。
// 平时只安静地尝试连接痕迹的本机端口，不接管任何东西；痕迹开始录制或重演时才生效。
import { initProbe } from "@henjicc/web-replay-probe";
import { version } from "../package.json";

initProbe({ app: { name: "知多少", version } });
