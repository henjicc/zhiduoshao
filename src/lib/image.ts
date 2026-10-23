// 用户上传的图片在本地压缩后再发送：长边不超过 1600px、JPEG 质量 0.86。
// 这样单张通常在几百 KB，请求体和历史记录都不会太大；文档建议单张不超过 10MB。

export const MAX_IMAGES = 4;
const MAX_EDGE = 1600;
const MAX_FILE = 20 * 1024 * 1024;
const QUALITY = 0.86;

export class ImageError extends Error {}

export async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new ImageError("只支持图片文件");
  if (file.size > MAX_FILE) throw new ImageError("图片太大了，请选择 20MB 以内的图片");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new ImageError("无法读取这张图片");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // 透明背景转 JPEG 会变黑，先铺白底
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

/** 只附图、没写问题时的默认问题 */
export const defaultImageQuestion = (count: number) => (count > 1 ? "这些图片里是什么？" : "这张图片里是什么？");
