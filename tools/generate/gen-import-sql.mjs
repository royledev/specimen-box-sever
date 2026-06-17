/**
 * 本番 import SQL 生成（ADR-0009: マニフェスト = 真実の源）。
 * 生成パイプラインのマニフェスト（rarity 入り）を読み、D1 images への INSERT SQL を出力する。
 *
 * tools/gen-seed.mjs（ローカル用・先頭 DELETE）と違い、本番投入用なので DELETE は付けない。
 * 既存プールへ追記する想定（idx は 1..N で衝突しないこと。衝突時は INSERT が失敗して気づける）。
 *
 * 使い方:
 *   node tools/generate/gen-import-sql.mjs <manifest.json> [out.sql]
 *   既定出力: <manifest と同じ場所>/seeds/prod/images.sql（本番 images シード）
 *
 * 投入（migration は schema 専用。seed はコマンドで明示適用）:
 *   npm run migrate:prod                          # schema（rarity/name 列含む）
 *   npm run seed:prod                             # seeds/prod/questions.sql + seeds/prod/images.sql
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: node gen-import-sql.mjs <manifest.json> [out.sql]");
  process.exit(1);
}
const outPath =
  process.argv[3] ?? join(dirname(manifestPath), "seeds", "prod", "images.sql");
mkdirSync(dirname(outPath), { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// gen-seed.mjs と同じ厳格検証（文字列補間の前にインジェクション・型崩れを排除）。
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
    throw new Error(`${field} が空か長すぎる (image_id=${imageId}, len=${value?.length})`);
  }
  if (hasControlChar(value)) {
    throw new Error(`${field} に制御文字 (image_id=${imageId})`);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

const seenIdx = new Set();
const lines = manifest.map((row) => {
  const { image_id, idx, r2_key, format, width, height, bytes, rarity, name } = row;
  if (!UUID_RE.test(image_id)) {
    throw new Error(`image_id が UUID 形式でない: ${JSON.stringify(image_id)}`);
  }
  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error(`format が許可外 (image_id=${image_id}, format=${JSON.stringify(format)})`);
  }
  if (typeof r2_key !== "string" || !R2_KEY_RE.test(r2_key)) {
    throw new Error(`r2_key が不正 (image_id=${image_id}, r2_key=${JSON.stringify(r2_key)})`);
  }
  for (const [k, v] of [["idx", idx], ["width", width], ["height", height], ["bytes", bytes]]) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`${k} が非負整数でない (image_id=${image_id}, ${k}=${v})`);
    }
  }
  if (seenIdx.has(idx)) throw new Error(`idx が重複: ${idx}`);
  seenIdx.add(idx);
  // rarity はマニフェストの値をそのまま信頼する（ADR-0009）。
  if (!Number.isInteger(rarity) || rarity < 1 || rarity > 5) {
    throw new Error(`rarity が不正 (image_id=${image_id}, rarity=${rarity})`);
  }
  // name は自由テキスト（日本語）。エスケープ＋検証して埋め込む（ADR-0010）。
  const nameSql = sqlText(name, "name", image_id);
  return `  ('${image_id}', ${idx}, '${r2_key}', '${format}', ${width}, ${height}, ${bytes}, 'active', ${rarity}, ${nameSql})`;
});

const sql = `-- 本番 images シード（tools/generate/gen-import-sql.mjs による自動生成・ADR-0009）。
-- 真実の源: 生成パイプラインのマニフェスト。手書きしない（gitignore・再生成可）。
-- 適用: npm run seed:prod（= wrangler d1 execute specimen-box-db --remote --file=seeds/prod/images.sql -c wrangler.prod.jsonc）
-- 注意: DELETE は付けない（既存プールへ追記）。idx は 1..N で衝突しないこと。

INSERT INTO images (image_id, idx, r2_key, format, width, height, bytes, status, rarity, name) VALUES
${lines.join(",\n")};
`;

writeFileSync(outPath, sql);
console.log(`import SQL -> ${outPath}  (${manifest.length} rows)`);
