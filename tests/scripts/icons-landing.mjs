// Іконки лендингу quizflow.space: курча (assets/icons/landing/chick.webp) -> favicon.ico, apple-touch-icon, icon-192/512.
// Запуск: cd tests && npm run icons:landing
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = new URL("../../assets/icons/landing/", import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const src = "data:image/webp;base64," + fs.readFileSync(new URL("chick.webp", OUT)).toString("base64");
const BLUE = "#2D5BE3";

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const p = await b.newPage();
await p.goto("about:blank");
async function render(size, bg, scale) {
  const url = await p.evaluate(async ({ src, size, bg, scale }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = c.height = size;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); }
    const k = Math.min(size * scale / img.width, size * scale / img.height), w = img.width * k, h = img.height * k;
    x.drawImage(img, (size - w) / 2, (size - h) / 2 + (bg ? 0 : size * 0.01), w, h);
    return c.toDataURL("image/png");
  }, { src, size, bg, scale });
  return Buffer.from(url.split(",")[1], "base64");
}
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = 6 + pngs.length * 16; const dir = [], body = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16); e[0] = size; e[1] = size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12);
    dir.push(e); body.push(buf); off += buf.length;
  }
  return Buffer.concat([head, ...dir, ...body]);
}
const fav = ico(await Promise.all([16, 32, 48].map(async s => ({ size: s, buf: await render(s, null, 1) }))));
fs.writeFileSync(new URL("favicon.ico", OUT), fav);
fs.writeFileSync(new URL("apple-touch-icon.png", OUT), await render(180, BLUE, 0.78));
fs.writeFileSync(new URL("icon-192.png", OUT), await render(192, BLUE, 0.72));
fs.writeFileSync(new URL("icon-512.png", OUT), await render(512, BLUE, 0.72));
fs.copyFileSync(new URL("favicon.ico", OUT), new URL("favicon.ico", ROOT));
fs.copyFileSync(new URL("apple-touch-icon.png", OUT), new URL("apple-touch-icon.png", ROOT));
await b.close();
console.log("готово: assets/icons/landing, /favicon.ico, /apple-touch-icon.png");
