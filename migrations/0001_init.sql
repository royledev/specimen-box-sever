-- 標本箱サーバー D1 初期スキーマ（ADR-0002・0003・0006）。
-- image_id は UUID（推測不可・連番排除）。
-- idx は 1..N の連番（ランダム引き用）。穴は status 判定で引き直し吸収（再採番しない）。

CREATE TABLE IF NOT EXISTS images (
  image_id  TEXT    PRIMARY KEY,        -- UUID（推測不可）
  idx       INTEGER NOT NULL UNIQUE,    -- 1..N 連番（ランダム idx 引き用）
  r2_key    TEXT    NOT NULL,           -- R2 上のオブジェクトキー（例: img/<uuid>.webp）
  format    TEXT    NOT NULL DEFAULT 'webp',
  width     INTEGER NOT NULL DEFAULT 768,
  height    INTEGER NOT NULL DEFAULT 768,
  bytes     INTEGER,                    -- ファイルサイズ（D1一次・R2 head は補助）
  batch     TEXT,                       -- 生成バッチ識別子（任意）
  phash     TEXT,                       -- 知覚ハッシュ（重複検知用・任意）
  status    TEXT    NOT NULL DEFAULT 'active' -- 'active' | 'inactive'
);

-- idx UNIQUE 制約でインデックスは自動生成されるため、明示的 CREATE INDEX は不要。

CREATE TABLE IF NOT EXISTS questions (
  id        TEXT    PRIMARY KEY,
  text      TEXT    NOT NULL,
  category  TEXT    NOT NULL,
  weight    REAL    NOT NULL DEFAULT 1.0,
  condition TEXT,                       -- NULL | 'midnightOnly' | 'weekendOnly'
  status    TEXT    NOT NULL DEFAULT 'active' -- 'active' | 'inactive'
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT    NOT NULL REFERENCES questions(id),
  from_at     TEXT    NOT NULL,         -- ISO8601 絶対時刻
  to_at       TEXT    NOT NULL          -- ISO8601 絶対時刻
);
