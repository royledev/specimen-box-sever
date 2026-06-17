#!/usr/bin/env bash
# smoke.sh — ローカルE2E疎通スクリプト（T5）。
# 前提: wrangler dev (:8787) が別ターミナルで起動済みであること。
# 実行: bash scripts/smoke.sh
#
# 検証する5点:
#   1. POST /v1/questions/next   — question が返ること
#   2. POST /v1/images/draw      — image.url が返ること
#   3. GET <image.url>           — 200 + 画像 Content-Type のバイトが返ること
#   4. POST /v1/answers          — 202 + { ok: true } が返ること
#   5. POST /v1/answers（X-Device-Token 付き）— 202 が返ること（トークン非読取確認）

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
PASS=0
FAIL=0

ok() { echo "[PASS] $*"; PASS=$((PASS + 1)); }
ng() { echo "[FAIL] $*"; FAIL=$((FAIL + 1)); }

# --- preflight: wrangler dev が起動しているか確認 ---
echo "=== preflight: ${BASE_URL}/health に接続確認 ==="
if ! curl -s --connect-timeout 2 "${BASE_URL}/health" > /dev/null 2>&1; then
  echo "[ERROR] ${BASE_URL} に接続できません。"
  echo "[ERROR] wrangler dev を先に起動してください: npm run dev"
  exit 1
fi
echo "[OK] サーバーが応答しています。"

# jq の有無を確認。なければ grep フォールバック。
if command -v jq &>/dev/null; then
  HAS_JQ=1
else
  HAS_JQ=0
  echo "[INFO] jq が見つかりません。grep フォールバックで疎通を検証します。"
fi

echo ""
echo "=== [1/3] POST /v1/questions/next ==="
QBODY='{"recent":[],"localTime":"2026-06-13T12:00:00+09:00"}'
QRES=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/v1/questions/next" \
  -H "Content-Type: application/json" \
  -d "${QBODY}")
QHTTP=$(echo "${QRES}" | tail -1)
QJSON=$(echo "${QRES}" | sed '$d')

if [ "${QHTTP}" = "200" ]; then
  if [ "${HAS_JQ}" = "1" ]; then
    QID=$(echo "${QJSON}" | jq -r '.question.id // empty' 2>/dev/null || true)
    if [ -n "${QID}" ]; then
      ok "question.id = ${QID}"
    else
      ng "レスポンスに question.id がない: ${QJSON}"
    fi
  else
    # grep フォールバック
    if echo "${QJSON}" | grep -q '"question"'; then
      ok "question キーを確認（grep）"
    else
      ng "レスポンスに question キーがない: ${QJSON}"
    fi
  fi
else
  ng "HTTP ${QHTTP}  body: ${QJSON}"
fi

echo ""
echo "=== [2/3] POST /v1/images/draw ==="
IBODY='{"owned":[]}'
IRES=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/v1/images/draw" \
  -H "Content-Type: application/json" \
  -d "${IBODY}")
IHTTP=$(echo "${IRES}" | tail -1)
IJSON=$(echo "${IRES}" | sed '$d')

IMAGE_URL=""
if [ "${IHTTP}" = "200" ]; then
  if [ "${HAS_JQ}" = "1" ]; then
    IMAGE_URL=$(echo "${IJSON}" | jq -r '.image.url // empty' 2>/dev/null || true)
    if [ -n "${IMAGE_URL}" ]; then
      ok "image.url = ${IMAGE_URL}"
      # IMAGE_CDN_BASE が正しく設定されているか警告
      if [[ "${IMAGE_URL}" != *"localhost:8787/dev/img"* ]]; then
        echo "[WARN] image.url が localhost:8787/dev/img を指していません: ${IMAGE_URL}"
        echo "[WARN] .dev.vars の IMAGE_CDN_BASE=http://localhost:8787/dev/img を確認してください。"
      fi
      # レア度（ADR-0008/0009）: image.rarity が 1..5 で返ること
      RARITY=$(echo "${IJSON}" | jq -r '.image.rarity // empty' 2>/dev/null || true)
      if [[ "${RARITY}" =~ ^[1-5]$ ]]; then
        ok "image.rarity = ★${RARITY}"
      else
        ng "image.rarity が 1..5 で返っていません: ${RARITY}"
      fi
      # 表示名（ADR-0010）: image.name が空でない文字列で返ること
      NAME=$(echo "${IJSON}" | jq -r '.image.name // empty' 2>/dev/null || true)
      if [ -n "${NAME}" ]; then
        ok "image.name = ${NAME}"
      else
        ng "image.name が空です: ${IJSON}"
      fi
    else
      ng "レスポンスに image.url がない（枯渇？）: ${IJSON}"
    fi
  else
    # grep フォールバック: URL をsedで取り出し試みる
    IMAGE_URL=$(echo "${IJSON}" | grep -oE '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//')
    if [ -n "${IMAGE_URL}" ]; then
      ok "image.url を確認（grep）: ${IMAGE_URL}"
      # IMAGE_CDN_BASE が正しく設定されているか警告
      if [[ "${IMAGE_URL}" != *"localhost:8787/dev/img"* ]]; then
        echo "[WARN] image.url が localhost:8787/dev/img を指していません: ${IMAGE_URL}"
        echo "[WARN] .dev.vars の IMAGE_CDN_BASE=http://localhost:8787/dev/img を確認してください。"
      fi
    else
      ng "レスポンスに image.url がない: ${IJSON}"
    fi
  fi
else
  ng "HTTP ${IHTTP}  body: ${IJSON}"
fi

echo ""
echo "=== [3/3] GET <image.url> で画像バイト取得 ==="
if [ -z "${IMAGE_URL}" ]; then
  ng "image.url が取得できなかったためスキップ"
else
  # IMAGE_URL が相対パスの場合は BASE_URL を補う（通常は絶対URL）。
  if [[ "${IMAGE_URL}" != http* ]]; then
    IMAGE_URL="${BASE_URL}${IMAGE_URL}"
  fi

  IMG_HEADERS=$(curl -s -o /dev/null -D - "${IMAGE_URL}" 2>/dev/null | head -20)
  IMG_HTTP=$(echo "${IMG_HEADERS}" | head -1 | grep -oE '[0-9]{3}' | head -1 || true)
  IMG_CT=$(echo "${IMG_HEADERS}" | grep -i '^content-type:' | head -1 | tr -d '\r' || true)

  if [ "${IMG_HTTP}" = "200" ]; then
    if echo "${IMG_CT}" | grep -qi 'image/'; then
      ok "画像バイト取得成功 (${IMG_CT})"
    else
      ng "HTTP 200 だが Content-Type が image でない: ${IMG_CT}"
    fi
  else
    ng "画像取得 HTTP ${IMG_HTTP}  URL: ${IMAGE_URL}"
  fi
fi

echo ""
echo "=== [4/5] POST /v1/answers ==="
ABODY='{"questionId":"q-meaningless-01","answerText":"smoke test"}'
ARES=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/v1/answers" \
  -H "Content-Type: application/json" \
  -d "${ABODY}")
AHTTP=$(echo "${ARES}" | tail -1)
AJSON=$(echo "${ARES}" | sed '$d')

if [ "${AHTTP}" = "202" ]; then
  if echo "${AJSON}" | grep -q '"ok":true'; then
    ok "POST /v1/answers → 202 + { ok: true }"
  else
    ng "HTTP 202 だがレスポンスに ok:true がない: ${AJSON}"
  fi
else
  ng "HTTP ${AHTTP}  body: ${AJSON}"
fi

echo ""
echo "=== [5/5] POST /v1/answers（X-Device-Token 付き） ==="
ARES2=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/v1/answers" \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: dummy" \
  -d "${ABODY}")
AHTTP2=$(echo "${ARES2}" | tail -1)
AJSON2=$(echo "${ARES2}" | sed '$d')

if [ "${AHTTP2}" = "202" ]; then
  ok "X-Device-Token: dummy 付きでも 202（トークン非読取確認）"
else
  ng "X-Device-Token 付きで HTTP ${AHTTP2}  body: ${AJSON2}"
fi

echo ""
echo "=== 結果 ==="
echo "PASS: ${PASS} / FAIL: ${FAIL}"
if [ "${FAIL}" -gt 0 ]; then
  echo "疎通に失敗したテストがあります。"
  exit 1
else
  echo "全テスト通過。"
  exit 0
fi
