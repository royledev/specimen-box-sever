#!/usr/bin/env bash
# seed-local.sh — ローカルE2E基盤のワンコマンドセットアップ（T4・冪等）。
# 前提: node が PATH に存在すること。wrangler は npx 経由で使用する。
# 実行: bash scripts/seed-local.sh
# または: npm run seed:local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DB_NAME="specimen-box-db"
BUCKET_NAME="specimen-box-images"
# 開発用 seed（migrations は schema 専用。seed はここで明示適用する）
QUESTIONS_SQL="${REPO_ROOT}/seeds/dev/questions.sql"
SEED_SQL="${REPO_ROOT}/seeds/dev/images.sql"
IMAGES_DIR="${REPO_ROOT}/tools/dummy-images"
DEV_VARS="${REPO_ROOT}/.dev.vars"
DEV_VARS_EXAMPLE="${REPO_ROOT}/.dev.vars.example"

# wrangler は npx 経由または PATH のどちらかを使う。
if command -v wrangler &>/dev/null; then
  WRANGLER="wrangler"
else
  WRANGLER="npx wrangler"
fi

# --- .dev.vars チェック＆生成 ---
if [ ! -f "${DEV_VARS}" ]; then
  echo "[INFO] .dev.vars が見つかりません。"
  if [ -f "${DEV_VARS_EXAMPLE}" ]; then
    echo "[INFO] .dev.vars.example からコピーして .dev.vars を生成します。"
    cp "${DEV_VARS_EXAMPLE}" "${DEV_VARS}"
  else
    echo "[INFO] .dev.vars.example も見つかりません。デフォルト内容で .dev.vars を生成します。"
    cat > "${DEV_VARS}" <<'DEVVARS'
# ローカル開発用変数（.dev.vars.example からコピー）。
IMAGE_CDN_BASE=http://localhost:8787/dev/img
DEVVARS
  fi
  echo "[INFO] .dev.vars を生成しました: ${DEV_VARS}"
else
  # .dev.vars が存在する場合は IMAGE_CDN_BASE が設定されているか確認
  if ! grep -q '^IMAGE_CDN_BASE=' "${DEV_VARS}"; then
    echo "[WARN] .dev.vars に IMAGE_CDN_BASE が設定されていません。"
    echo "[WARN] ローカルE2Eでは IMAGE_CDN_BASE=http://localhost:8787/dev/img が必要です。"
    echo "[WARN] .dev.vars に以下を追加してください:"
    echo "       IMAGE_CDN_BASE=http://localhost:8787/dev/img"
  fi
fi

echo "=== [1/4] ダミー画像＋マニフェスト生成 ==="
node "${REPO_ROOT}/tools/gen-dummy-images.mjs"

echo ""
echo "=== [2/4] seed SQL 生成 ==="
node "${REPO_ROOT}/tools/gen-seed.mjs"

echo ""
echo "=== [3/4] D1 migrations 適用（--local）==="
${WRANGLER} d1 migrations apply "${DB_NAME}" --local

echo ""
echo "=== [4a/4] R2 ローカルへ画像投入（wrangler r2 object put --local）==="
# manifest.json の r2_key を使って投入（冪等: put は上書き）。
export REPO_ROOT BUCKET_NAME IMAGES_DIR WRANGLER
node - <<'EOF_NODE'
const { readFileSync } = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const manifest = JSON.parse(readFileSync(path.join(process.env.REPO_ROOT, "tools/dummy-images/manifest.json"), "utf-8"));
const imagesDir = process.env.IMAGES_DIR;
const bucketName = process.env.BUCKET_NAME;
const wrangler = process.env.WRANGLER;

for (const entry of manifest) {
  const fileName = path.basename(entry.r2_key);
  const filePath = path.join(imagesDir, fileName);
  const objectKey = `${bucketName}/${entry.r2_key}`;
  process.stdout.write(`  put ${entry.r2_key} ... `);
  execSync(
    `${wrangler} r2 object put "${objectKey}" --file "${filePath}" --content-type image/png --local`,
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  console.log("ok");
}
EOF_NODE

echo ""
echo "=== [4b/4] D1 seed 適用（--local）==="
# migrations は schema 専用なので、questions / images の seed はここでコマンド適用する。
${WRANGLER} d1 execute "${DB_NAME}" --local --file="${QUESTIONS_SQL}"
${WRANGLER} d1 execute "${DB_NAME}" --local --file="${SEED_SQL}"

echo ""
echo "=== 完了 ==="
echo "次: npm run dev  で wrangler dev を起動し、別ターミナルで bash scripts/smoke.sh を実行してください。"
