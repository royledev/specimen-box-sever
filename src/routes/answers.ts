// POST /v1/answers（ADR-0007: 匿名・非連結なアンケート回答受付）。
// このルートは X-Device-Token を読まない・要求しない・保存しない。
// IP ベースの粗いレート制限のみ（別名前空間キー ans:ip:<ip>）。

import { Hono } from "hono";
import type { Env } from "../types";
import { answersSubmitSchema, validationErrorBody } from "../schema";
import { insertAnswer } from "../lib/db/answersRepo";
import { checkRateLimit } from "../lib/rateLimit";
import { utcDayStamp } from "../lib/time";
import { D1Error } from "../lib/db/errors";

export const answersRoute = new Hono<{ Bindings: Env }>();

answersRoute.post("/", async (c) => {
  // --- IP ベース粗いレート制限（別名前空間キー / トークン非読取） ---
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const max = Number(c.env.ANSWERS_RATE_LIMIT_MAX ?? "10");
  const windowSec = Number(c.env.ANSWERS_RATE_LIMIT_WINDOW_SEC ?? "60");

  const rl = await checkRateLimit(c.env.RATE_LIMIT, `ans:ip:${ip}`, max, windowSec);
  if (!rl.ok) {
    c.header("Retry-After", String(rl.retryAfter ?? windowSec));
    return c.json({ error: "rate_limited" }, 429);
  }

  // --- リクエストパース ---
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", message: "body must be JSON" }, 400);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "invalid_request", message: "body must be a JSON object" }, 400);
  }

  const parsed = answersSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(validationErrorBody(c.env, parsed.error.issues), 400);
  }
  const { questionId, answerText } = parsed.data;

  // --- day はサーバー UTC 由来の yyyymmdd（精密時刻・クライアント時刻を使わない） ---
  const day = utcDayStamp();

  // --- 書き込み（fail-open: DB 例外でも best-effort で 202 を返す） ---
  try {
    await insertAnswer(c.env.DB, { questionId, answerText, day });
  } catch (e) {
    if (e instanceof D1Error) {
      // best-effort: 書き込み失敗でも 202 で返す（クライアントに再試行の責務を渡さない）。
      // ※エラーの cause には失敗クエリのバインド値（answer_text）が含まれ得るため、
      //   種別のみログする（CWE-532 / ADR-0007 の匿名性をログでも維持）。
      console.error("insertAnswer failed (fail-open)", { name: e.name });
      return c.json({ ok: true }, 202);
    }
    throw e;
  }

  return c.json({ ok: true }, 202);
});
