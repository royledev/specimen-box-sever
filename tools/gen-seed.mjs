/**
 * 開発用 images シード SQL 生成スクリプト（T2）。
 * tools/dummy-images/manifest.json を読み、D1 images テーブル用の dev seed SQL を
 * seeds/dev/images.sql に出力する。手書きしない（gitignore・再生成可）。
 *
 * 実行: node tools/gen-seed.mjs（npm run gen:images / seed-local.sh から呼ばれる）
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MANIFEST_PATH = join(__dirname, "dummy-images", "manifest.json");
const OUT_PATH = join(REPO_ROOT, "seeds", "dev", "images.sql");
mkdirSync(dirname(OUT_PATH), { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

// SQL は文字列補間で組むため、文字列フィールドは厳格に検証する（将来 manifest が外部由来になっても
// インジェクション不能にする）。数値は型・範囲で検証。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_FORMATS = new Set(["png", "webp"]);
const R2_KEY_RE = /^[A-Za-z0-9._/-]+$/;
const NAME_MAX = 80;

/** 制御文字（C0 + DEL）を含むか。ソースに制御文字リテラルを置かないよう code point で判定。 */
function hasControlChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** 自由テキスト（name）を SQL リテラル化する。単一引用符をエスケープし、長さ・制御文字を検証（ADR-0010）。 */
function sqlText(value, field, imageId) {
  if (typeof value !== "string" || value.length === 0 || value.length > NAME_MAX) {
    throw new Error(`manifest の ${field} が空か長すぎる (image_id=${imageId}, len=${value?.length})`);
  }
  if (hasControlChar(value)) {
    throw new Error(`manifest の ${field} に制御文字 (image_id=${imageId})`);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

const seenIdx = new Set();
const lines = manifest.map((row) => {
  const { image_id, idx, r2_key, format, width, height, bytes, rarity, name } = row;
  if (!UUID_RE.test(image_id)) {
    throw new Error(`manifest の image_id が UUID 形式でない: ${JSON.stringify(image_id)}`);
  }
  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error(`manifest の format が許可外 (image_id=${image_id}, format=${JSON.stringify(format)})`);
  }
  if (typeof r2_key !== "string" || !R2_KEY_RE.test(r2_key)) {
    throw new Error(`manifest の r2_key が不正 (image_id=${image_id}, r2_key=${JSON.stringify(r2_key)})`);
  }
  for (const [k, v] of [["idx", idx], ["width", width], ["height", height], ["bytes", bytes]]) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`manifest の ${k} が非負整数でない (image_id=${image_id}, ${k}=${v})`);
    }
  }
  // idx は D1 で UNIQUE。重複を SQL 実行前に検出する（gen-import-sql.mjs と同等）。
  if (seenIdx.has(idx)) throw new Error(`manifest の idx が重複: ${idx}`);
  seenIdx.add(idx);
  // rarity はマニフェストの値をそのまま信頼する（ADR-0009: 生成パイプラインがクォータ配分で確定）。
  if (!Number.isInteger(rarity) || rarity < 1 || rarity > 5) {
    throw new Error(`manifest の rarity が不正 (image_id=${image_id}, rarity=${rarity})`);
  }
  // name は自由テキスト（日本語）。エスケープ＋検証して埋め込む（ADR-0010）。
  const nameSql = sqlText(name, "name", image_id);
  return `  ('${image_id}', ${idx}, '${r2_key}', '${format}', ${width}, ${height}, ${bytes}, 'active', ${rarity}, ${nameSql})`;
});

const sql = `-- ローカル開発用 images シード（tools/gen-seed.mjs による自動生成）。
-- 真実の源: tools/dummy-images/manifest.json
-- 本番環境には適用しない。
-- 再生成: node tools/gen-dummy-images.mjs && node tools/gen-seed.mjs
--
-- DELETE FROM images は冪等性確保のため先頭に置く。
-- これにより seed-local.sh 再実行後は images が本ファイルの内容のみになる。
-- （migrations の webp5行など旧行が残らないことを保証する）

DELETE FROM images;

INSERT INTO images (image_id, idx, r2_key, format, width, height, bytes, status, rarity, name) VALUES
${lines.join(",\n")};
`;

writeFileSync(OUT_PATH, sql);
console.log(`seed SQL -> ${OUT_PATH}  (${manifest.length} rows)`);
