-- questions シード【開発用】（client specimen-box の assets/questions/questions.json と一致する v1 23問）。
-- migration には入れない（schema 専用）。ローカルE2E は seed-local.sh がこのファイルを --local 適用する。
-- 本番は seeds/prod/questions.sql（将来 1000 問へ拡張）を別途コマンド適用する。
-- 先頭で旧レコードを一掃（冪等）し、23問を INSERT する。id 不変（標本の questionId スナップショットに使う）。

DELETE FROM questions;

INSERT INTO questions (id, text, category, weight, condition, status) VALUES
  ('q-meaningless-01', '今日いちばん意味のなかった行動は？',              'meaningless', 1.0, NULL,           'active'),
  ('q-meaningless-02', 'さっき無意識にやっていた小さな癖は？',            'meaningless', 1.0, NULL,           'active'),
  ('q-meaningless-03', '今日いちばんどうでもよかった決断は？',            'meaningless', 0.9, NULL,           'active'),
  ('q-sound-01',       '今いちばんどうでもいい音は？',                    'sound',       1.0, NULL,           'active'),
  ('q-sound-02',       '今いちばん小さく聞こえている音は？',              'sound',       0.9, NULL,           'active'),
  ('q-sense-01',       '今いちばん近くにあるにおいは？',                  'sense',       0.9, NULL,           'active'),
  ('q-sense-02',       '今ふれているものの手ざわりを一言で',              'sense',       0.9, NULL,           'active'),
  ('q-object-01',      '今、手の届く範囲で一番安いものは？',              'object',      1.0, NULL,           'active'),
  ('q-object-02',      '今いちばん近くにある四角いものは？',              'object',      0.9, NULL,           'active'),
  ('q-object-03',      '要らないのに捨てられないものを一つ',              'object',      0.8, NULL,           'active'),
  ('q-body-01',        '今いちばん力が抜けている体の部位は？',            'body',        0.9, NULL,           'active'),
  ('q-body-02',        '今日いちばん多く使った指は？',                    'body',        0.7, NULL,           'active'),
  ('q-time-01',        '今日いちばん長く感じた一分は何をしていた？',      'time',        0.9, NULL,           'active'),
  ('q-time-02',        'さっき、何もしていなかった時間に何をしていた？',  'time',        0.8, NULL,           'active'),
  ('q-relation-01',    '今日すれ違った、いちばん覚えていない人は？',      'relation',    0.8, NULL,           'active'),
  ('q-place-01',       '今いる場所で、いちばん見ていない方向に何がある？', 'place',       0.9, NULL,           'active'),
  ('q-place-02',       '今いちばん遠くに見えているものは？',              'place',       0.8, NULL,           'active'),
  ('q-impulse-01',     '今いちばんどうでもいい欲求は？',                  'impulse',     0.9, NULL,           'active'),
  ('q-impulse-02',     '今すぐやめてもいい習慣を一つ',                    'impulse',     0.8, NULL,           'active'),
  ('q-midnight-01',    '今、起きている理由を一言で',                      'time',        1.0, 'midnightOnly', 'active'),
  ('q-midnight-02',    'この時間にだけ聞こえる音は？',                    'sound',       1.0, 'midnightOnly', 'active'),
  ('q-midnight-03',    '眠れない理由の、いちばん小さいものは？',          'meaningless', 0.9, 'midnightOnly', 'active'),
  ('q-weekend-01',     '今日いちばん予定がなかった時間は？',              'time',        0.9, 'weekendOnly',  'active');
