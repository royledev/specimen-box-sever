-- 標本レア度の導入（ADR-0009、旧 ADR-0008 を Supersede）。
-- rarity は各標本(image)の不変・固有プロパティ（1=★1 〜 5=★5）で、見た目にも反映される。
-- 抽選は一様ランダム（ADR-0004 不変）のため、プール構成比 = 排出率。
--
-- 値は生成パイプラインがクォータ配分で確定し（src/lib/rarity.ts allocateRarities）、
-- マニフェスト → seed/import SQL 経由で投入する（旧: image_id ハッシュ事後割り当ては廃止）。
-- このマイグレーションは列追加のみ（DEFAULT 1）。ローカルは seed:local 再実行で正しい値に上書きされる。

ALTER TABLE images ADD COLUMN rarity INTEGER NOT NULL DEFAULT 1;
