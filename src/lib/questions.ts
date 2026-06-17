// 問い選定ロジック（純粋関数 / ADR-0006）。サーバーは個人状態を持たず、
// 端末供給の recent（直近問いID窓）で反復回避・カテゴリ偏り回避を行う。
// D1由来の QuestionRow / BroadcastRow を使う。

import type { QuestionRow, BroadcastRow } from "./db/questionsRepo";
import type { LocalContext } from "./time";

export type { QuestionRow, BroadcastRow };

/** condition を満たすか（ローカル壁時計で判定）。 */
export function isEligible(q: QuestionRow, ctx: LocalContext): boolean {
  switch (q.condition) {
    case "midnightOnly":
      return ctx.hour >= 0 && ctx.hour < 5; // 0–4 時
    case "weekendOnly":
      return ctx.isWeekend;
    case null:
      return true;
    default:
      return true;
  }
}

/** 有効期間内の一斉配信スロットがあれば、その問いを返す（ADR-0004 §3）。 */
export function activeBroadcastQuestion(
  questions: QuestionRow[],
  broadcasts: BroadcastRow[],
  now: Date,
): QuestionRow | null {
  const t = now.getTime();
  for (const slot of broadcasts) {
    const from = Date.parse(slot.from_at);
    const to = Date.parse(slot.to_at);
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    if (t >= from && t <= to) {
      const q = questions.find((x) => x.id === slot.question_id);
      if (q) return q;
    }
  }
  return null;
}

interface SelectArgs {
  recent: string[];
  ctx: LocalContext;
  now: Date;
  /** 0..1 を返す乱数源（テスト時は決定論 PRNG を注入）。 */
  random: () => number;
}

export interface SelectResult {
  question: QuestionRow;
  broadcast: boolean;
}

/**
 * 問いを1問選ぶ。
 * 1) 一斉配信が有効ならそれを返す（recent 無視・broadcast=true）。
 * 2) condition で候補を絞り、recent を除外。
 * 3) recent 内で多いカテゴリの重みを一時的に下げる（連続同種の抑制）。
 * 4) 重み付き抽選で1問。
 * 候補が空（全部 recent or 条件で枯渇）なら recent を無視して再試行。なお無ければ null。
 */
export function selectQuestion(
  questions: QuestionRow[],
  broadcasts: BroadcastRow[],
  args: SelectArgs,
): SelectResult | null {
  const broadcast = activeBroadcastQuestion(questions, broadcasts, args.now);
  if (broadcast) return { question: broadcast, broadcast: true };

  const recentSet = new Set(args.recent);
  let candidates = questions.filter(
    (q) => isEligible(q, args.ctx) && !recentSet.has(q.id),
  );
  if (candidates.length === 0) {
    // フォールバック: 条件は維持しつつ recent 除外を緩める。
    candidates = questions.filter((q) => isEligible(q, args.ctx));
  }
  if (candidates.length === 0) return null;

  // カテゴリ偏り回避: recent に含まれる各問いのカテゴリ出現数で重みを減衰。
  const idToCategory = new Map(questions.map((q) => [q.id, q.category] as const));
  const recentCatCount = new Map<string, number>();
  for (const id of args.recent) {
    const cat = idToCategory.get(id);
    if (cat) recentCatCount.set(cat, (recentCatCount.get(cat) ?? 0) + 1);
  }

  const weighted = candidates.map((q) => {
    const n = recentCatCount.get(q.category) ?? 0;
    const w = Math.max(0, q.weight) * Math.pow(0.5, n); // 同カテゴリが recent に1件あるごとに半減
    return { q, w };
  });

  const question = weightedPick(weighted, args.random);
  return { question, broadcast: false };
}

/** 重み付き抽選。全重み0なら均等抽選にフォールバック。 */
export function weightedPick(
  items: { q: QuestionRow; w: number }[],
  random: () => number,
): QuestionRow {
  const total = items.reduce((s, it) => s + it.w, 0);
  if (total <= 0) {
    return items[Math.floor(random() * items.length)].q;
  }
  let r = random() * total;
  for (const it of items) {
    r -= it.w;
    if (r < 0) return it.q;
  }
  return items[items.length - 1].q; // 浮動小数の端数対策
}
