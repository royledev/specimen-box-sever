/**
 * ダミー画像生成スクリプト（T1）。
 * pngjs で 16 枚の判別用ラベル付き png（連番・色違い・idx 簡易マーカー）を
 * tools/dummy-images/ に出力し、マニフェスト JSON も同ディレクトリに生成する。
 *
 * 実行: node tools/gen-dummy-images.mjs
 */

import { PNG } from "pngjs";
import { createWriteStream, mkdirSync, writeFileSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { allocateRarities } from "./rarity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "dummy-images");
const NAMES_PATH = join(__dirname, "generate", "names.json");

mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 64;
const HEIGHT = 64;
const TOTAL = 16;

/**
 * idx から決定論的な UUID を生成する（乱数不使用）。
 * フォーマット: 00000000-0000-4000-a000-<12桁のzero-padded idx>
 */
function idxToUuid(idx) {
  const padded = String(idx).padStart(12, "0");
  return `00000000-0000-4000-a000-${padded}`;
}

/**
 * idx (1..16) に応じた背景色を返す（色相を等分割して判別）。
 * HSL → RGB 変換（pure JS）。
 */
function hslToRgb(h, s, l) {
  // h: 0..360, s/l: 0..1
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * idx (1..16) 番号を 5x7 ドットパターン（簡易ビットマップフォント）で焼き込む。
 * 2桁まで対応（1..16）。ドットは白(255,255,255)で描画。
 * パターン: 上位/下位の数字を 1x 縦バーパターンで表現。
 */
// 0..9 の 5列×7行の簡易フォント（各行 = 5ビット、MSB左）
const FONT5x7 = [
  // 0
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  // 1
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  // 2
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  // 3
  [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  // 4
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  // 5
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  // 6
  [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  // 7
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  // 8
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  // 9
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
];

/**
 * 1桁の数字を PNG データバッファに描画する。
 * @param {Buffer} data - PNG data バッファ (RGBA)
 * @param {number} digit - 0..9
 * @param {number} startX - 描画開始 X
 * @param {number} startY - 描画開始 Y
 * @param {number} scale - 拡大倍率
 */
function drawDigit(data, digit, startX, startY, scale, width) {
  const pattern = FONT5x7[digit];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      const bit = (pattern[row] >> (4 - col)) & 1;
      if (bit) {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = startX + col * scale + sx;
            const py = startY + row * scale + sy;
            const idx = (py * width + px) * 4;
            data[idx] = 255;     // R
            data[idx + 1] = 255; // G
            data[idx + 2] = 255; // B
            data[idx + 3] = 255; // A
          }
        }
      }
    }
  }
}

/**
 * PNG ファイルを生成して保存し、ファイルサイズを返す Promise。
 */
function generatePng(filePath, bgR, bgG, bgB, idx) {
  return new Promise((resolve, reject) => {
    // colorType:2 = RGB（アルファなし）を指定。
    // ただし pngjs の内部データバッファは常に RGBA(×4) で管理される。
    // エンコード時に colorType:2 に従い RGB 変換されて出力される（実害なし）。
    const png = new PNG({ width: WIDTH, height: HEIGHT, colorType: 2 });
    const data = png.data;

    // 背景色で全ピクセル塗りつぶし
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        data[i] = bgR;
        data[i + 1] = bgG;
        data[i + 2] = bgB;
        data[i + 3] = 255;
      }
    }

    // idx 番号を 2桁で焼き込む（例: 1→"01", 16→"16"）
    const label = String(idx).padStart(2, "0");
    const d1 = parseInt(label[0], 10);
    const d2 = parseInt(label[1], 10);
    const scale = 4;
    const charWidth = 5 * scale;
    const totalWidth = charWidth * 2 + scale; // 2桁 + 1桁分の間隔
    const startX = Math.floor((WIDTH - totalWidth) / 2);
    const startY = Math.floor((HEIGHT - 7 * scale) / 2);

    drawDigit(data, d1, startX, startY, scale, WIDTH);
    drawDigit(data, d2, startX + charWidth + scale, startY, scale, WIDTH);

    const out = createWriteStream(filePath);
    out.on("finish", () => {
      try {
        const size = statSync(filePath).size;
        resolve(size);
      } catch (e) {
        reject(e);
      }
    });
    out.on("error", reject);
    png.pack().pipe(out);
  });
}

async function main() {
  const manifest = [];

  // レア度はクォータ配分で先に確定する（ADR-0009 決定2・3）。
  // idx 順に割り当てるため、★1 から並んだ配列を idx-1 で引く。
  // 注: TOTAL=16 では構成比上 ★5 は 0 枚（実プールで収束）。
  const rarities = allocateRarities(TOTAL);

  // ローカルE2E用のダミー表示名は、実プールと同じ真実の源（names.json）の先頭 TOTAL 件を使う（ADR-0011）。
  // 実プールは generate.py が names.json をシャッフルして使う。ダミーは先頭から決定論的に取る。
  const wordList = JSON.parse(readFileSync(NAMES_PATH, "utf-8"));
  if (!Array.isArray(wordList) || wordList.length < TOTAL) {
    throw new Error(`names.json が不足: ${wordList.length} 件 < ${TOTAL}（${NAMES_PATH}）`);
  }
  const NAMES = wordList.slice(0, TOTAL).map((w) => w.name);

  for (let i = 1; i <= TOTAL; i++) {
    const imageId = idxToUuid(i);
    const r2Key = `img/${imageId}.png`;
    const fileName = `${imageId}.png`;
    const filePath = join(OUT_DIR, fileName);
    const rarity = rarities[i - 1];

    // idx に応じた色相（等分割）
    const hue = ((i - 1) / TOTAL) * 360;
    const [bgR, bgG, bgB] = hslToRgb(hue, 0.7, 0.45);

    const bytes = await generatePng(filePath, bgR, bgG, bgB, i);

    manifest.push({
      image_id: imageId,
      idx: i,
      r2_key: r2Key,
      format: "png",
      width: WIDTH,
      height: HEIGHT,
      bytes,
      rarity,
      name: NAMES[i - 1],
    });

    console.log(`[${i}/${TOTAL}] ${fileName}  (${bytes} bytes)  bg=rgb(${bgR},${bgG},${bgB})  ★${rarity}  ${NAMES[i - 1]}`);
  }

  const manifestPath = join(OUT_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nmanifest -> ${manifestPath}  (${manifest.length} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
