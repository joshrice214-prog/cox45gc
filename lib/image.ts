"use client";

/** Orient, downscale to the vision sweet spot, and lift contrast so pencil separates from card. */
export async function prepScorecardImage(file: File): Promise<{ b64: string; mime: string; preview: string }> {
  const bmp = await loadBitmap(file);
  const MAX = 1568;
  let { width: w, height: h } = bmp;
  const scale = Math.min(1, MAX / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const k = 1.22, m = 128 * (1 - k);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] * k + m);
      d[i + 1] = clamp(d[i + 1] * k + m);
      d[i + 2] = clamp(d[i + 2] * k + m);
    }
    ctx.putImageData(img, 0, 0);
  } catch {}
  const url = c.toDataURL("image/jpeg", 0.85);
  bmp.close?.();
  return { b64: url.split(",")[1], mime: "image/jpeg", preview: url };
}

/** Square-crop and shrink a profile photo before upload. */
export async function prepAvatar(file: File, size = 320): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - s) / 2, sy = (bmp.height - s) / 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, s, s, 0, 0, size, size);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.88));
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}
const clamp = (v: number) => Math.min(255, Math.max(0, v));
