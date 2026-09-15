// Generate PWA icons (192px, 512px, apple-touch) from a simple SVG drawn on a canvas.
// No external image libs needed — we draw the brand mark manually.

import { createCanvas } from "canvas";
import { writeFileSync } from "fs";

function drawBrandMark(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background — warm amber gradient
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#fb923c");
  grad.addColorStop(1, "#ea580c");
  ctx.fillStyle = grad;
  const r = size * 0.22;
  roundRect(ctx, 0, 0, size, size, r);
  ctx.fill();

  // Parcel outline (hexagon shape)
  const cx = size / 2;
  const top = size * 0.22;
  const bottom = size * 0.78;
  const left = size * 0.22;
  const right = size * 0.78;
  const midY = (top + bottom) / 2;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(right, (top + midY) / 2);
  ctx.lineTo(right, midY + (bottom - midY) * 0.55);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(left, midY + (bottom - midY) * 0.55);
  ctx.lineTo(left, (top + midY) / 2);
  ctx.closePath();
  ctx.fill();

  // Top fold (lighter)
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(right, (top + midY) / 2);
  ctx.lineTo(cx, midY * 0.85);
  ctx.lineTo(left, (top + midY) / 2);
  ctx.closePath();
  ctx.fill();

  // Upward arrow (orange on white)
  ctx.fillStyle = "#ea580c";
  const aw = size * 0.18; // arrow width
  const ah = size * 0.18; // arrow head height
  const asw = size * 0.07; // shaft width
  const arrowY = size * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx, arrowY);
  ctx.lineTo(cx + aw / 2, arrowY + ah);
  ctx.lineTo(cx + asw, arrowY + ah);
  ctx.lineTo(cx + asw, arrowY + ah * 2);
  ctx.lineTo(cx - asw, arrowY + ah * 2);
  ctx.lineTo(cx - asw, arrowY + ah);
  ctx.lineTo(cx - aw / 2, arrowY + ah);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const outDir = "/home/z/my-project/public";
const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon-32.png", size: 32 },
];
for (const s of sizes) {
  const canvas = drawBrandMark(s.size);
  const buf = canvas.toBuffer("image/png");
  writeFileSync(`${outDir}/${s.name}`, buf);
  console.log(`Wrote ${outDir}/${s.name} (${s.size}px, ${buf.length} bytes)`);
}
