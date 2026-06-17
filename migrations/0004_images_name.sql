-- 標本の表示名（name）の導入（ADR-0010）。
-- name は各標本(image)の不変・固有プロパティ＝日本語の表示名（例「怒った扇風機」）。
-- rarity と同じく生成時に確定し、マニフェスト → seed/import SQL 経由で投入する。
--
-- このマイグレーションは列追加のみ（DEFAULT ''）。ローカルは seed:local 再実行で正しい値に上書きされる。

ALTER TABLE images ADD COLUMN name TEXT NOT NULL DEFAULT '';
