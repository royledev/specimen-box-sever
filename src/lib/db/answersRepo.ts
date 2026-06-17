// answers テーブルへの書き込み専用アクセス層（ADR-0007: 匿名・非連結）。
// シグネチャは { questionId, answerText, day } のみ — IP / token / 精密時刻を引数に取らない。
// これにより非連結を保存層の型で担保し、誤混入を防ぐ。

import { D1Error } from "./errors";

export interface InsertAnswerParams {
  questionId: string;
  answerText: string;
  /** サーバー UTC 由来の粗い日付 yyyymmdd（精密時刻は持たない）。 */
  day: string;
}

/** answers テーブルへ1行挿入する。
 * id は **ランダム UUIDv4**（crypto.randomUUID）。連番 PK が漏らす総件数・挿入順を避け、
 * かつ UUIDv7 のような生成時刻も埋め込まない（ADR-0007 匿名・非連結 / 精密時刻を持たない）。 */
export async function insertAnswer(
  db: D1Database,
  params: InsertAnswerParams,
): Promise<void> {
  try {
    const id = crypto.randomUUID(); // v4（ランダム・タイムスタンプ非埋め込み）
    await db
      .prepare("INSERT INTO answers(id, question_id, answer_text, day) VALUES(?,?,?,?)")
      .bind(id, params.questionId, params.answerText, params.day)
      .run();
  } catch (e) {
    throw new D1Error("D1 insertAnswer failed", { cause: e });
  }
}
