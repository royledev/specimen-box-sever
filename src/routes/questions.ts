// POST /v1/questions/next（ADR-0004 §2 / ADR-0006）。

import { Hono } from "hono";
import type { Env, QuestionsNextResponse } from "../types";
import { questionsNextSchema, validationErrorBody } from "../schema";
import {
  fetchActiveQuestions,
  fetchActiveBroadcasts,
} from "../lib/db/questionsRepo";
import { selectQuestion } from "../lib/questions";
import { localContextFromISO } from "../lib/time";

export const questionsRoute = new Hono<{ Bindings: Env }>();

questionsRoute.post("/next", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", message: "body must be JSON" }, 400);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "invalid_request", message: "body must be a JSON object" }, 400);
  }

  const parsed = questionsNextSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(validationErrorBody(c.env, parsed.error.issues), 400);
  }
  const body = parsed.data;

  // broadcasts の有効期間判定はサーバー時刻で行う（管理者設定の配信窓を端末が操作できないよう）。
  // condition 判定（localContext）は端末申告の localTime を引き続き使う。
  const serverNow = new Date();
  const ctx = localContextFromISO(body.localTime);

  const [questions, broadcasts] = await Promise.all([
    fetchActiveQuestions(c.env.DB),
    fetchActiveBroadcasts(c.env.DB, serverNow.toISOString()),
  ]);

  const result = selectQuestion(questions, broadcasts, {
    recent: body.recent,
    ctx,
    now: serverNow,
    random: Math.random,
  });

  if (!result) {
    return c.json({ error: "no_question_available" }, 503);
  }

  const res: QuestionsNextResponse = {
    question: {
      id: result.question.id,
      text: result.question.text,
      category: result.question.category,
      condition: result.question.condition,
    },
    broadcast: result.broadcast,
  };
  return c.json(res);
});
