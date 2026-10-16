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

const BLUE = [31, 95, 191];
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

writeFileSync(resolve(OUT, 'icon-192.png'), icon(192, false));
writeFileSync(resolve(OUT, 'icon-512.png'), icon(512, false));
writeFileSync(resolve(OUT, 'icon-maskable-512.png'), icon(512, true));
// og-image.png (с заголовком) рисуется отдельно — здесь нет шрифтов, поэтому скрипт его не создаёт
console.log('Иконки сохранены в', OUT);
