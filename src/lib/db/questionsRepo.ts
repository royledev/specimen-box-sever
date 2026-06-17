// D1 questions / broadcasts テーブルへのアクセス層（ADR-0006）。
// 純粋ロジックとI/Oを分離するため、純粋関数はこのファイルに依存しない。

import { D1Error } from "./errors";

export interface QuestionRow {
  id: string;
  text: string;
  category: string;
  weight: number;
  condition: string | null;
  status: string;
}

export interface BroadcastRow {
  id: string;            // UUIDv4（migration 0005 で INTEGER から変更）
  question_id: string;
  from_at: string;
  to_at: string;
}

/** active な全問いを取得。 */
export async function fetchActiveQuestions(db: D1Database): Promise<QuestionRow[]> {
  try {
    const result = await db
      .prepare("SELECT * FROM questions WHERE status = 'active'")
      .all<QuestionRow>();
    return result.results ?? [];
  } catch (e) {
    throw new D1Error("D1 fetchActiveQuestions failed", { cause: e });
  }
}

/** 有効期間内の broadcasts（now は ISO 文字列で比較）。 */
export async function fetchActiveBroadcasts(
  db: D1Database,
  nowIso: string,
): Promise<BroadcastRow[]> {
  try {
    const result = await db
      .prepare(
        "SELECT * FROM broadcasts WHERE from_at <= ?1 AND to_at >= ?1",
      )
      .bind(nowIso)
      .all<BroadcastRow>();
    return result.results ?? [];
  } catch (e) {
    throw new D1Error("D1 fetchActiveBroadcasts failed", { cause: e });
  }
}
