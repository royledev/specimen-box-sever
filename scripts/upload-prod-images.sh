#!/usr/bin/env bash
# upload-prod-images.sh — 透過WebPを本番 R2 へ投入する（ADR-0009 / 冪等: put=上書き）。
#   ローカル: webp/webp_transparent/<image_id>.webp
#   R2 キー : img/<image_id>.webp   （seeds/prod/images.sql の r2_key と一致）
#   content-type: image/webp
# 前提: wrangler ログイン済み（OAuth）。実行: bash scripts/upload-prod-images.sh
# 環境変数: PARALLEL（既定 6）, SRC_DIR（既定 webp/webp_transparent）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUCKET_NAME="specimen-box-images"
SRC_DIR="${SRC_DIR:-${REPO_ROOT}/webp/webp_transparent}"
PARALLEL="${PARALLEL:-6}"

# wrangler は同梱バイナリ優先（npx の起動オーバーヘッド回避）。
WRANGLER="${REPO_ROOT}/node_modules/.bin/wrangler"
[ -x "${WRANGLER}" ] || WRANGLER="npx wrangler"

TOTAL="$(find "${SRC_DIR}" -name '*.webp' | wc -l | tr -d ' ')"
echo "対象 ${TOTAL} 件 → r2://${BUCKET_NAME}/img/  （並列 ${PARALLEL}）"

LOG="$(mktemp)"
export BUCKET_NAME WRANGLER
find "${SRC_DIR}" -name '*.webp' -print0 \
  | xargs -0 -P "${PARALLEL}" -I {} bash -c '
      f="$1"; key="img/$(basename "$f")"
      if $WRANGLER r2 object put "${BUCKET_NAME}/${key}" --file "$f" --content-type image/webp >/dev/null 2>&1; then
        echo "ok   ${key}"
      else
        echo "FAIL ${key}"
      fi
    ' _ {} | tee "${LOG}"

ok="$(grep -c '^ok '   "${LOG}" 2>/dev/null || true)"
fail="$(grep -c '^FAIL ' "${LOG}" 2>/dev/null || true)"
echo "----"
echo "完了: ok=${ok} fail=${fail} / 計 ${TOTAL}"
grep '^FAIL ' "${LOG}" 2>/dev/null || true
rm -f "${LOG}"
[ "${fail:-0}" -eq 0 ]
