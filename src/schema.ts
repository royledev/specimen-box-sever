import { z } from "zod";

// リクエスト検証（ADR-0004）。端末は最小情報のみ送る（回答本文・個人情報は送らない）。

export const questionsNextSchema = z.object({
  /** 直近に出した問いID窓（反復回避・カテゴリ偏り回避に使う）。 */
  recent: z.array(z.string().max(64)).max(200).default([]),
  /** 条件判定用のローカル時刻（tz オフセット必須）。例: 2026-06-12T23:40:00+09:00 */
  localTime: z.string().datetime({ offset: true }),
});
export type QuestionsNextInput = z.infer<typeof questionsNextSchema>;

/** POST /v1/answers リクエスト検証（ADR-0007: 匿名・非連結）。個人情報・端末情報は送らない。 */
export const answersSubmitSchema = z.object({
  /** 問いID（1〜64文字）。 */
  questionId: z.string().min(1).max(64),
  /** 回答本文（1〜500文字）。 */
  answerText: z.string().min(1).max(500),
});
export type AnswersSubmitInput = z.infer<typeof answersSubmitSchema>;

export const imagesDrawSchema = z.object({
  /**
   * 端末が所有する image_id 群（除外集合）。
   * image_id は UUID（最大 36 文字）。上限 11,000 件（1日3件×10年≒10,950）。
   */
  owned: z.array(z.string().max(36)).max(11000).default([]),
});
export type ImagesDrawInput = z.infer<typeof imagesDrawSchema>;

/**
 * 400 検証エラーの応答ボディ。**本番では zod の issues（内部スキーマ構造）を返さない**
 * （CWE-209 情報露出の最小化）。dev/test では details を残して DX を維持する。
 */
export function validationErrorBody(
  env: { ENVIRONMENT?: string },
  issues: unknown,
): { error: "invalid_request"; details?: unknown } {
  if (env.ENVIRONMENT === "production") {
    return { error: "invalid_request" };
  }
  return { error: "invalid_request", details: issues };
}
