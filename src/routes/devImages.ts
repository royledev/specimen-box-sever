// GET /dev/img/:key{.+} — ローカル開発専用画像配信ルート（T3）。
// ENVIRONMENT=production の場合は 404。
// それ以外は env.IMAGES (R2) からバイトを返す（Content-Type: format から解決）。
// /v1 の外（認証・レート制限の外）にマウントする。

import { Hono } from "hono";
import type { Env } from "../types";

export const devImagesRoute = new Hono<{ Bindings: Env }>();

/** format 文字列から Content-Type を解決。未知は application/octet-stream。 */
function formatToContentType(format: string): string {
  switch (format.toLowerCase()) {
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif":  return "image/gif";
    case "avif": return "image/avif";
    default:     return "application/octet-stream";
  }
}

/** r2_key のファイル拡張子から Content-Type を解決（format が取れない場合のフォールバック）。 */
function keyToContentType(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return formatToContentType(ext);
}

devImagesRoute.get("/img/*", async (c) => {
  // production では無効。
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "not_found" }, 404);
  }

  // パラメータではなく URL パスから key を取得（スラッシュを含む）。
  const url = new URL(c.req.url);
  // pathname: /dev/img/<key>  → prefix を除去して key を取り出す。
  const prefix = "/dev/img/";
  const key = decodeURIComponent(url.pathname.slice(prefix.length));

  if (!key) {
    return c.json({ error: "not_found" }, 404);
  }

  // R2 バインディングが無い場合（テスト等）は 404。
  if (!c.env.IMAGES) {
    return c.json({ error: "not_found" }, 404);
  }

  const obj = await c.env.IMAGES.get(key);
  if (obj === null) {
    return c.json({ error: "not_found" }, 404);
  }

  // Content-Type: R2 オブジェクトのメタデータ優先、なければ拡張子から解決。
  const contentType =
    obj.httpMetadata?.contentType ?? keyToContentType(key);

  const bytes = await obj.arrayBuffer();
  return c.newResponse(bytes, 200, {
    "Content-Type": contentType,
    "Content-Length": String(bytes.byteLength),
  });
});
