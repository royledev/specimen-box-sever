-- 0005: id 系を UUID 化（ADR-0007 匿名強化 / ADR-0006）。
-- answers.id / broadcasts.id を INTEGER AUTOINCREMENT → TEXT(UUIDv4) に変更する。
--   - answers: 連番 PK は「総件数」「挿入順」を漏らす。ADR-0007 の匿名・非連結方針に沿って
--     ランダム UUIDv4（タイムスタンプを埋め込まない＝精密時刻も漏らさない）にする。
--     ※UUIDv7 は生成時刻(ms)を埋め込むため不採用。アプリが crypto.randomUUID() で生成（answersRepo.ts）。
--   - broadcasts: 内部テーブルだが PK を UUID に統一。
-- questions.id は client(specimen-box の assets/questions/questions.json)と共有の安定 slug のため変更しない
--   （公開コンテンツ＋回答は匿名なので予測可能でも安全。slug 維持がカタログ id のベストプラクティス）。
-- ※ SQLite は PK の型変更に非対応のためテーブルを再作成する。本プロジェクトは本番未投入のため
--   既存行は破棄してよい（answers=匿名追記データ / broadcasts=未シード）。images / questions は触らない。

DROP TABLE IF EXISTS answers;
CREATE TABLE answers (
  id          TEXT    PRIMARY KEY,   -- UUIDv4（アプリ生成・ランダム＝連番/順序/時刻を漏らさない）
  question_id TEXT    NOT NULL,
  answer_text TEXT    NOT NULL,
  day         TEXT    NOT NULL       -- 粗い日付 yyyymmdd（精密時刻は持たない）
);
CREATE INDEX IF NOT EXISTS idx_answers_question_day ON answers(question_id, day);

DROP TABLE IF EXISTS broadcasts;
CREATE TABLE broadcasts (
  id          TEXT    PRIMARY KEY,   -- UUIDv4
  question_id TEXT    NOT NULL REFERENCES questions(id),
  from_at     TEXT    NOT NULL,      -- ISO8601 絶対時刻
  to_at       TEXT    NOT NULL       -- ISO8601 絶対時刻
);
