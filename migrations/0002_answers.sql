-- answers テーブル（ADR-0007: 匿名・非連結な回答受付）。
-- 保存するのは { question_id, answer_text, day } のみ。
-- device_id / IP / 精密時刻 の列は設けない（設計上の不在）。

CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT    NOT NULL,
  answer_text TEXT    NOT NULL,
  day         TEXT    NOT NULL  -- 粗い日付 yyyymmdd（精密時刻は持たない）
);

CREATE INDEX IF NOT EXISTS idx_answers_question_day ON answers(question_id, day);
