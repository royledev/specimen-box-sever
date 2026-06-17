/**
 * 本番 questions シード生成（1000件）。出力: seeds/prod/questions.sql（DELETE + INSERT）。
 *
 * 世界観（問い設計 / ADR-0006）: 「自分の観察」に寄せた、無意味・どうでもいい・地味な気づきの問い。
 * 下ネタ・他者を貶める方向は避ける。id は安定 slug `q-<category>-NNN`。
 *
 * ※これは**機械生成のたたき台**。人手キュレーション前提（不自然な文言は適宜削る/直す）。
 *   再生成: node tools/gen-questions.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO_ROOT, "seeds", "prod", "questions.sql");
const TARGET = 1000;

// 決定論シャッフル（Math.random を使わない＝再現可能）。
function shuffle(arr, seed) {
  let s = seed >>> 0;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 文字列リストの直積を連結。
const cross = (...lists) =>
  lists.reduce((acc, l) => acc.flatMap((a) => l.map((b) => a + b)), [""]);

// --- カテゴリ別の生成バンク ---
// 各カテゴリは「groups（内部だけで直積を取るブロック）」と「stems（完成文）」を持つ。
// 直積は **同一グループ内に限定** することで、相性の悪い pre×adj×noun の組み合わせ
// （時制不一致・語の非互換・「いちばん＋二値属性」など）が生まれないようにする。
// 1 グループ内では pre/adj/noun のどれを取り替えても自然に繋がる語だけを集める。
const CATS = {
  meaningless: {
    groups: [
      { pre: ["今日いちばん", "さっき", "今日のうちで", "ついさっき", "今日"],
        adj: ["意味のなかった", "どうでもよかった", "無駄だった", "なんとなくした", "理由もなくした",
              "やらなくてもよかった", "誰にも関係ない", "覚えなくていい"],
        noun: ["行動", "動き", "選択", "ひとりごと"] },
    ],
    stems: ["さっき無意識にやっていた小さな癖は？", "今すぐやめても何も変わらない動作を一つ",
            "今日、誰にも気づかれずにやったことは？", "今日いちばん意味のなかった行動は？",
            "今、なんとなく続けてしまっていることは？", "今日、声に出さなかったひとりごとは？"],
  },
  sound: {
    groups: [
      { pre: ["今いちばん", "今日いちばん", "この場所でいちばん", "今"],
        adj: ["小さく聞こえる", "遠くで鳴っている", "かすかな", "単調な", "耳に残る", "低い",
              "誰も気にしていない", "リズムのある", "ずっと続いている"],
        noun: ["音", "物音", "響き"] },
    ],
    stems: ["この時間にだけ聞こえる音は？", "今、止まったら少し寂しい音は？",
            "今いちばん小さく聞こえている音は？", "今いちばんどうでもいい音は？"],
  },
  sense: {
    // 嗅覚・空気感・触覚。noun ごとに繋がる adj が違うのでグループで分離する。
    groups: [
      // におい/香り（嗅覚）
      { pre: ["今いちばん", "今日いちばん", "さっき気づいた", "今ふと感じた"],
        adj: ["近くにある", "気になっている", "遠くから漂う", "覚えのある", "なんともいえない",
              "意識していなかった", "かすかな"],
        noun: ["におい", "香り"] },
      // 空気
      { pre: ["今いちばん", "今日いちばん", "今"],
        adj: ["落ち着く", "気になっている", "意識していなかった", "こもった", "ひんやりした",
              "なんともいえない", "乾いた", "湿った"],
        noun: ["空気"] },
      // 温度（「いちばん」と相性の悪い程度表現があるため pre から外す）
      { pre: ["今", "今日"],
        adj: ["落ち着く", "気になっている", "意識していなかった", "ちょうどいい", "少し低い", "少し高い", "なんともいえない"],
        noun: ["温度"] },
      // 触覚
      { pre: ["今ふれている", "今いちばん近くにある", "さっきさわった"],
        adj: ["やわらかい", "つるつるした", "ざらざらした", "ひんやりした", "あたたかい"],
        noun: ["もの"] },
    ],
    stems: ["今ふれているものの手ざわりを一言で", "今いちばん近くにあるにおいは？",
            "今、足の裏に感じているものは？", "今いちばん冷たく感じるものは？",
            "今、肌にいちばん近い感触は？", "今ふれているものは何でできている感じ？"],
  },
  object: {
    groups: [
      // 視覚で分かる、程度のある属性（「いちばん」と相性が良い）
      { pre: ["今いちばん近くにある", "視界の中でいちばん", "足元でいちばん", "今、手の届く範囲でいちばん"],
        adj: ["安い", "古い", "軽い", "重い", "小さい", "丸い", "光っている", "白い", "黒い",
              "新しい", "平たい", "つやのある"],
        noun: ["もの"] },
      // 手ざわり（視覚 pre は付けない）
      { pre: ["今、手の届く範囲にある", "今ふれている", "すぐそばにある", "今、手元にある"],
        adj: ["やわらかい", "つるつるした", "ざらざらした", "角のある", "ひんやりした"],
        noun: ["もの"] },
      // 二値・分類的な属性（「いちばん」を付けず、存在を問う形にする）
      { pre: ["今、目の前にある", "机や床にある", "今、そばにある"],
        adj: ["ふたのある", "中身の見えない", "名前を知らない", "半分使った", "誰かにもらった",
              "買ったのを忘れていた", "色のついた", "ラベルのついた", "埃をかぶった"],
        noun: ["もの"] },
      // 時間・所在
      { pre: ["今いちばん", "今日いちばん"],
        adj: ["長く同じ場所にある", "長く使っている", "使っていない", "手垢のついた"],
        noun: ["もの"] },
    ],
    stems: ["要らないのに捨てられないものを一つ", "今、手の届く範囲で一番安いものは？",
            "今いちばん近くにある四角いものは？", "今いちばん長く同じ場所にあるものは？",
            "今、机や床に置きっぱなしのものは？", "今いちばん手垢のついているものは？"],
  },
  body: {
    groups: [
      // 部位全般（ところ/部分）
      { pre: ["今いちばん", "今日いちばん", "今、無意識に"],
        adj: ["力が抜けている", "こっている", "冷えている", "疲れている", "緊張している", "汗ばんでいる",
              "かゆい", "重く感じる", "じっとしている", "触れている", "だるい", "しびれた", "熱い"],
        noun: ["ところ", "部分"] },
      // 指・筋肉（かゆい等は付けない）
      { pre: ["今いちばん", "今日いちばん"],
        adj: ["力が抜けている", "こっている", "緊張している", "よく動かした", "疲れている"],
        noun: ["指", "筋肉"] },
      // 過去（さっきまで＝過去形で揃える）
      { pre: ["さっきまで"],
        adj: ["力が入っていた", "緊張していた", "動かしていた", "こっていた", "冷えていた"],
        noun: ["ところ", "部分"] },
    ],
    stems: ["今日いちばん多く使った指は？", "今いちばん力が抜けている体の部位は？",
            "今、いちばん深く呼吸している感じがするのはどこ？", "今、無意識に触れている体の部分は？"],
  },
  time: {
    groups: [
      { pre: ["今日いちばん", "さっき、", "今日、", "今日のうちで"],
        adj: ["長く感じた", "短く感じた", "早く過ぎた", "何もしていなかった", "ぼんやりしていた",
              "急いでいた", "止まって見えた", "意味もなく待った", "だらけた"],
        noun: ["時間", "一分", "数分", "ひととき"] },
    ],
    stems: ["今日いちばん長く感じた一分は何をしていた？", "さっき、何もしていなかった時間に何をしていた？",
            "今日、最初に時計を見たのはいつ？", "今日いちばんぼーっとしていた時間は？"],
  },
  relation: {
    groups: [
      // 人・相手（「すれ違った」等の観察動詞は非段階的なので「いちばん」は付けない。
      //           最上級ニュアンスは stems の「いちばん覚えていない人」で担保する）
      { pre: ["今日", "さっき", "最近", "ついさっき"],
        adj: ["すれ違った", "名前を知らない", "目が合った", "声だけ聞いた", "顔だけ知っている",
              "連絡していない", "ちらっと見た", "覚えていない"],
        noun: ["人", "相手"] },
      // 顔
      { pre: ["今日", "さっき", "最近", "ついさっき"],
        adj: ["目が合った", "ちらっと見た", "名前を知らない", "見覚えのある", "覚えていない"],
        noun: ["顔"] },
      // 会話・やりとり（見る系は付けない）
      { pre: ["今日", "さっき", "ついさっき"],
        adj: ["どうでもよかった", "覚えていない", "声だけの", "かみ合わなかった", "中身のなかった"],
        noun: ["会話", "やりとり"] },
    ],
    stems: ["今日すれ違った、いちばん覚えていない人は？", "今日いちばんどうでもよかった会話は？",
            "最近、連絡していないのに少し気になる人は？", "今日、名前を知らないのに見た顔は？"],
  },
  place: {
    groups: [
      { pre: ["今いる場所で、いちばん", "今いちばん", "この部屋でいちばん"],
        adj: ["見ていない", "暗い", "狭い", "使っていない", "ほこりっぽい", "近づいていない",
              "落ち着く", "視界に入っていない"],
        noun: ["方向", "隅", "ところ", "あたり"] },
      // 背中の向こう（見ていない系のみ）
      { pre: ["今、背中の向こうで", "今、背中の後ろで"],
        adj: ["見ていない", "気づいていない"],
        noun: ["方向", "あたり"] },
    ],
    stems: ["今いる場所で、いちばん見ていない方向に何がある？", "今いちばん遠くに見えているものは？",
            "今、背中の後ろに何がある？", "今いる場所でいちばん使っていない隅は？"],
  },
  impulse: {
    groups: [
      // 状態・程度の属性（「なんとなく」とは相性が悪いので別グループにする）
      { pre: ["今いちばん", "今日いちばん", "今、"],
        adj: ["どうでもいい", "やめてもいい", "意味のない", "小さな", "理由のない",
              "我慢している", "気になってしまう", "急に出てきた"],
        noun: ["欲求", "衝動", "気持ち", "思いつき"] },
      // 「なんとなく」は動作・状態の動詞句とだけ繋ぐ
      { pre: ["なんとなく"],
        adj: ["気になってしまう", "我慢している", "やめてもいい"],
        noun: ["欲求", "衝動", "気持ち", "思いつき"] },
      { pre: ["今、", "今いちばん"],
        adj: ["やりたいけどやらない", "やらずにいる", "ずっと先延ばしにしている"],
        noun: ["こと"] },
    ],
    stems: ["今すぐやめてもいい習慣を一つ", "今いちばんどうでもいい欲求は？",
            "今、なんとなくやりたいけどやらないことは？", "今いちばん「どうでもいいけど気になる」ことは？"],
  },
};

// 条件付き（夜だけ／週末だけ）。世界観に沿った専用文。
const CONDITIONED = [
  // midnightOnly
  ["今、起きている理由を一言で", "time", "midnightOnly"],
  ["この時間にだけ聞こえる音は？", "sound", "midnightOnly"],
  ["眠れない理由の、いちばん小さいものは？", "meaningless", "midnightOnly"],
  ["こんな時間に考えてしまうことを一つ", "meaningless", "midnightOnly"],
  ["この時間に急にやりたくなったことは？", "impulse", "midnightOnly"],
  ["今、いちばん暗い場所はどこ？", "place", "midnightOnly"],
  ["眠る前にやめられない動作は？", "body", "midnightOnly"],
  ["この時間に思い出した昔のことは？", "time", "midnightOnly"],
  ["夜更けにいちばん大きく聞こえる音は？", "sound", "midnightOnly"],
  ["この時間にしか出てこない考えは？", "meaningless", "midnightOnly"],
  ["今、時計を見て思ったことは？", "time", "midnightOnly"],
  ["夜にだけ気づく体の感覚は？", "body", "midnightOnly"],
  ["今いちばん遠くにある光は？", "place", "midnightOnly"],
  ["今日をひとことでしめくくると？", "meaningless", "midnightOnly"],
  ["今いちばん消したい明かりは？", "object", "midnightOnly"],
  ["夜に飲みたくなるものは？", "impulse", "midnightOnly"],
  ["この時間の自分を一言で", "meaningless", "midnightOnly"],
  ["今、まだ誰にも言っていないことは？", "relation", "midnightOnly"],
  // weekendOnly
  ["今日いちばん予定がなかった時間は？", "time", "weekendOnly"],
  ["週末なのに結局やらなかったことは？", "meaningless", "weekendOnly"],
  ["今日いちばんだらけた瞬間は？", "time", "weekendOnly"],
  ["この休みでいちばんどうでもよかったことは？", "meaningless", "weekendOnly"],
  ["今日、二度寝した時間は？", "time", "weekendOnly"],
  ["週末だけやる小さな習慣を一つ", "impulse", "weekendOnly"],
  ["今日いちばん長く座っていた場所は？", "place", "weekendOnly"],
  ["休みの日にだけ気づくことは？", "sense", "weekendOnly"],
  ["週末の終わりに少し惜しいものは？", "object", "weekendOnly"],
  ["休みなのに気になってしまうことは？", "impulse", "weekendOnly"],
];

// --- 生成 ---
const catNames = Object.keys(CATS);
// カテゴリ別の重複なし候補プール。
const pools = {};
for (const c of catNames) {
  const { groups, stems } = CATS[c];
  // グループ内だけで直積を取る（グループ間では混ぜない＝相性を担保）。
  const combo = groups.flatMap((g) => cross(g.pre, g.adj, g.noun)).map((s) => s + "は？");
  const uniq = Array.from(new Set([...stems, ...combo]));
  pools[c] = shuffle(uniq, 0x9e3779b1 ^ c.length ^ (c.charCodeAt(0) << 8));
}

const condTexts = new Set(CONDITIONED.map((r) => r[0]));
const seen = new Set(condTexts);
const chosen = []; // {text, category, condition}
for (const [text, category, condition] of CONDITIONED) {
  chosen.push({ text, category, condition });
}

// 残り（1000 - 条件付き）をカテゴリ・ラウンドロビンで採用。
const NORMAL_TARGET = TARGET - CONDITIONED.length;
const cursors = Object.fromEntries(catNames.map((c) => [c, 0]));
let i = 0;
let guard = 0;
while (chosen.length < TARGET && guard < 100000) {
  guard++;
  const c = catNames[i++ % catNames.length];
  const pool = pools[c];
  while (cursors[c] < pool.length && seen.has(pool[cursors[c]])) cursors[c]++;
  if (cursors[c] < pool.length) {
    const text = pool[cursors[c]++];
    seen.add(text);
    chosen.push({ text, category: c, condition: null });
  }
}
if (chosen.length < TARGET) {
  console.error(`プール不足: ${chosen.length}/${TARGET}。バンクを増やしてください。`);
  process.exit(1);
}

// カテゴリ別に id を採番（q-<cat>-NNN・出現順）。weight は決定論で軽く変化。
const perCatCount = {};
const WEIGHTS = [1.0, 0.9, 1.0, 1.1, 0.8, 1.0, 0.9, 1.0];
const rows = chosen.slice(0, TARGET).map((q, idx) => {
  perCatCount[q.category] = (perCatCount[q.category] || 0) + 1;
  const n = String(perCatCount[q.category]).padStart(3, "0");
  return {
    id: `q-${q.category}-${n}`,
    text: q.text,
    category: q.category,
    weight: WEIGHTS[idx % WEIGHTS.length],
    condition: q.condition,
    status: "active",
  };
});

// 検証: 件数・id一意・text一意・制御文字なし。
const ids = new Set(rows.map((r) => r.id));
const texts = new Set(rows.map((r) => r.text));
if (rows.length !== TARGET) throw new Error(`件数 ${rows.length} != ${TARGET}`);
if (ids.size !== TARGET) throw new Error("id が重複しています");
if (texts.size !== TARGET) throw new Error("text が重複しています");
for (const r of rows) {
  if (/[ -]/.test(r.text)) throw new Error(`制御文字: ${r.id}`);
  if (r.text.length < 1 || r.text.length > 80) throw new Error(`text 長さ違反: ${r.id}`);
}

const esc = (s) => s.replace(/'/g, "''");
const sqlRows = rows.map((r) => {
  const cond = r.condition ? `'${r.condition}'` : "NULL";
  return `  ('${r.id}', '${esc(r.text)}', '${r.category}', ${r.weight}, ${cond}, '${r.status}')`;
});

// INSERT は 1 文にまとめると SQLITE_TOOBIG（statement too long）になるためバッチ分割する。
const BATCH = 200;
const inserts = [];
for (let k = 0; k < sqlRows.length; k += BATCH) {
  inserts.push(
    "INSERT INTO questions (id, text, category, weight, condition, status) VALUES\n" +
      sqlRows.slice(k, k + BATCH).join(",\n") +
      ";",
  );
}

const sql = `-- questions シード【本番用】。tools/gen-questions.mjs による自動生成（${TARGET}件）。
-- migration には入れず、コマンドで明示適用する: npm run seed:prod:questions
-- 世界観: 自分の観察・無意味/どうでもいい系（問い設計 / ADR-0006）。**機械生成のたたき台＝人手キュレーション前提**。
-- 再生成: node tools/gen-questions.mjs
-- 先頭で旧レコードを一掃（冪等）してから INSERT する（1文が長すぎる SQLITE_TOOBIG 回避のため ${BATCH} 件ずつ分割）。id は不変。

DELETE FROM questions;

${inserts.join("\n\n")}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql);
const condCount = rows.filter((r) => r.condition).length;
console.log(`questions seed -> ${OUT}  (${rows.length} 件 / 条件付き ${condCount})`);
for (const c of catNames) console.log(`  ${c}: ${perCatCount[c] || 0}`);
