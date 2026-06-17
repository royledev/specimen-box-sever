// 標本箱サーバー エントリポイント（Hono on Cloudflare Workers / ADR-0002・0004・0005）。
// API は薄い読み取り専用層: 問い取得 / ランダム標本画像取得。

import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import type { Env } from "./types";
import { validationErrorBody } from "./schema";
import { appKeyGuard, rateLimitMw } from "./middleware";
import { questionsRoute } from "./routes/questions";
import { imagesRoute } from "./routes/images";
import { devImagesRoute } from "./routes/devImages";
import { answersRoute } from "./routes/answers";
import { assertProdCreds } from "./lib/imageUrl";
import { D1Error } from "./lib/db/errors";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));

// /dev: 認証・レート制限の外（ローカル開発専用。prod では各エンドポイントが 404 を返す）。
app.route("/dev", devImagesRoute);

// /v1: 認証（任意）は全体に1回。
// rateLimitMw（X-Device-Token 読取）は questions/images のみ。
// answers は rateLimitMw の対象外（ADR-0007: 非連結を構造担保）。
// bodyLimit: 巨大ボディの読み込み/パースを防ぐ（CWE-400）。エンドポイント別に許容サイズを設定。
//   images は owned 最大 11,000×UUID(36B) ≈ 430KB を許容するため大きめ（512KB）。
//   questions（recent 最大 200×64B ≈ 13KB）/ answers（≤500字回答）は小さく絞る。
const tooLarge = (c: Context<{ Bindings: Env }>) =>
  c.json({ error: "payload_too_large" }, 413);
const v1 = new Hono<{ Bindings: Env }>();
v1.use("*", appKeyGuard);
v1.use("/questions/*", bodyLimit({ maxSize: 32 * 1024, onError: tooLarge }));
v1.use("/questions/*", rateLimitMw);
v1.use("/images/*", bodyLimit({ maxSize: 512 * 1024, onError: tooLarge }));
v1.use("/images/*", rateLimitMw);
v1.use("/answers/*", bodyLimit({ maxSize: 16 * 1024, onError: tooLarge }));
v1.route("/questions", questionsRoute);
v1.route("/images", imagesRoute);
v1.route("/answers", answersRoute);
app.route("/v1", v1);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// 型ベースの統一エラーハンドラ（400/401/404/429/5xx を snake_case `error` で統一）。
app.onError((err, c) => {
  // D1Error は Error のサブクラスなので先に判定する。
  if (err instanceof D1Error) {
    console.error("D1 error", err);
    return c.json({ error: "database_error" }, 500);
  }
  if (err instanceof ZodError) {
    return c.json(validationErrorBody(c.env, err.issues), 400);
  }
  if (err instanceof Error) {
    // localTime パース失敗など。
    if (err.message.startsWith("invalid localTime")) {
      return c.json({ error: "invalid_request", message: err.message }, 400);
    }
    // prod creds 未設定など起動時のFATAL。
    if (err.message.startsWith("FATAL:")) {
      console.error("fatal startup error", err);
      return c.json({ error: "internal_error" }, 500);
    }
  }
  console.error("unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
});

// Workers エクスポート: prod creds をリクエスト受付前にアサート。
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // prod 起動時にcreds未設定を即エラーにする（列挙穴を本番に残さない）。
    assertProdCreds(env);
    return app.fetch(req, env, ctx);
  },
};
