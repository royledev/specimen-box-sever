// 共通ミドルウェア（ADR-0005）。
// - appKeyGuard: APP_API_KEY が設定されていれば X-App-Key 一致を要求（軽い門・任意）。
// - rateLimitMw: トークン（X-Device-Token）主・IP（CF-Connecting-IP）従の鍵でレート制限。
//   KV 未バインド時はskip（best-effort維持）。KV例外はfail-open。

import type { Context, Next } from "hono";
import type { Env } from "./types";
import { checkRateLimit } from "./lib/rateLimit";

type Ctx = Context<{ Bindings: Env }>;

export async function appKeyGuard(c: Ctx, next: Next): Promise<Response | void> {
  const required = c.env.APP_API_KEY;
  if (required) {
    const got = c.req.header("X-App-Key");
    if (got !== required) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  await next();
}

export async function rateLimitMw(c: Ctx, next: Next): Promise<Response | void> {
  const token = c.req.header("X-Device-Token");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  // トークン主・IP従の鍵（ADR-0005: CGNAT誤検知緩和）。
  const key = token ? `tok:${token}` : `ip:${ip}`;
  // NaN になる場合は checkRateLimit 内でデフォルト値（60）に補正される。
  const max = Number(c.env.RATE_LIMIT_MAX ?? "60");
  const windowSec = Number(c.env.RATE_LIMIT_WINDOW_SEC ?? "60");

  const result = await checkRateLimit(c.env.RATE_LIMIT, key, max, windowSec);
  if (!result.ok) {
    c.header("Retry-After", String(result.retryAfter ?? windowSec));
    return c.json({ error: "rate_limited" }, 429);
  }
  await next();
}
