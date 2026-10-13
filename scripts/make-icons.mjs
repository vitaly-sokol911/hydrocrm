// Генерирует PNG-иконки PWA и картинку-превью для соцсетей без внешних зависимостей.
// Рисунок: капля масла на стальном фоне (как favicon.svg) и «гидролиния» на превью.
// Запуск: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = resolve(import.meta.dirname, '..', 'apps', 'web', 'public');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const S = 3; // сглаживание: 3×3 подвыборки на пиксель
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / S) / w, (y + (sy + 0.5) / S) / h);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const STEEL = [14, 31, 54];
const BLUE = [31, 95, 191];
const OIL = [232, 163, 23];
const WHITE = [255, 255, 255];

/** Капля: круг снизу + сужение вверх. Координаты нормированы к центру (cx, cy) и размеру s. */
function inDrop(x, y, cx, cy, s) {
  const dx = (x - cx) / s, dy = (y - cy) / s;
  if (dx * dx + (dy - 0.12) ** 2 < 0.19 ** 2) return true;
  if (dy < 0.12 && dy > -0.32) {
    const half = 0.19 * ((dy + 0.32) / 0.44) ** 0.9;
    return Math.abs(dx) < half;
  }
  return false;
}

// Иконка: синий скруглённый квадрат (у maskable — запас поля) и белая капля.
function icon(size, maskable) {
  return png(size, size, (x, y) => {
    const pad = maskable ? 0 : 0.04, r = 0.22;
    const qx = Math.max(Math.abs(x - 0.5) - (0.5 - pad - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - pad - r), 0);
    if (!maskable && qx * qx + qy * qy > r * r) return [0, 0, 0, 0];
    const s = maskable ? 0.8 : 1;
    if (inDrop(x, y, 0.5, 0.5, s)) return [...WHITE, 1];
    return [...BLUE, 1];
  });
}

// Превью 1200×630: стальной фон с бликами, капля и гидролиния с «маслом» до 5-го этапа из 7.
function og() {
  const W = 1200, H = 630;
  return png(W, H, (u, v) => {
    const x = u * W, y = v * H;
    const glow1 = Math.exp(-(((x - 150) ** 2 + (y - 80) ** 2) / 2 / 260 ** 2)) * 0.55;
    const glow2 = Math.exp(-(((x - 1100) ** 2 + (y - 520) ** 2) / 2 / 220 ** 2)) * 0.22;
    let c = STEEL.map((s, i) => s + (BLUE[i] - s) * glow1 + (OIL[i] - s) * glow2);
    // капля слева сверху
    const dx = (x - 140) / 120, dy = (y - 150) / 120;
    if (inDrop(dx * 0.5 + 0.5, dy * 0.5 + 0.5, 0.5, 0.5, 0.5)) c = WHITE;
    // гидролиния
    const lineY = 430, x0 = 140, x1 = 1060, stages = 7, current = 4;
    const fillX = x0 + ((x1 - x0) * current) / (stages - 1);
    if (Math.abs(y - lineY) < 9 && x > x0 && x < x1) c = x < fillX ? OIL : [52, 68, 92];
    for (let i = 0; i < stages; i++) {
      const nx = x0 + ((x1 - x0) * i) / (stages - 1);
      const d = Math.hypot(x - nx, y - lineY);
      if (d < 22) c = i < current ? OIL : i === current ? WHITE : [52, 68, 92];
      if (d < 13 && i >= current) c = STEEL;
      if (i === current && d < 8) c = BLUE;
    }
    return [...c.map(Math.round), 1];
  });
}

writeFileSync(resolve(OUT, 'icon-192.png'), icon(192, false));
writeFileSync(resolve(OUT, 'icon-512.png'), icon(512, false));
writeFileSync(resolve(OUT, 'icon-maskable-512.png'), icon(512, true));
writeFileSync(resolve(OUT, 'og-image.png'), og());
console.log('Иконки и превью сохранены в', OUT);
