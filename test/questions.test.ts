// 問い選定ロジックのテスト（純粋関数・スタブ不要）。
import { describe, it, expect } from "vitest";
import type { QuestionRow, BroadcastRow } from "../src/lib/questions";
import { isEligible, activeBroadcastQuestion, selectQuestion } from "../src/lib/questions";
import { mulberry32 } from "./helpers";

const questions: QuestionRow[] = [
  { id: "a1", text: "A1", category: "a", weight: 1, condition: null,           status: "active" },
  { id: "a2", text: "A2", category: "a", weight: 1, condition: null,           status: "active" },
  { id: "b1", text: "B1", category: "b", weight: 1, condition: null,           status: "active" },
  { id: "mid",  text: "深夜", category: "time", weight: 1, condition: "midnightOnly", status: "active" },
  { id: "wknd", text: "週末", category: "time", weight: 1, condition: "weekendOnly",  status: "active" },
];
const broadcasts: BroadcastRow[] = [];

const weekdayDaytime = { hour: 14, isWeekend: false };
const midnight        = { hour: 1,  isWeekend: false };
const weekend         = { hour: 14, isWeekend: true  };

describe("isEligible", () => {
  it("condition=null は常に可", () => {
    expect(isEligible(questions[0], weekdayDaytime)).toBe(true);
  });
  it("midnightOnly は 0-4 時のみ", () => {
    const q = questions.find((x) => x.id === "mid")!;
    expect(isEligible(q, midnight)).toBe(true);
    expect(isEligible(q, weekdayDaytime)).toBe(false);
  });
  it("weekendOnly は土日のみ", () => {
    const q = questions.find((x) => x.id === "wknd")!;
    expect(isEligible(q, weekend)).toBe(true);
    expect(isEligible(q, weekdayDaytime)).toBe(false);
  });
});

describe("selectQuestion", () => {
  it("condition で絞られる（平日昼に深夜/週末問いは出ない）", () => {
    for (let s = 0; s < 50; s++) {
      const r = selectQuestion(questions, broadcasts, {
        recent: [],
        ctx: weekdayDaytime,
        now: new Date("2026-06-12T14:00:00Z"),
        random: mulberry32(s),
      });
      expect(r).not.toBeNull();
      expect(["mid", "wknd"]).not.toContain(r!.question.id);
    }
  });

  it("recent に含まれる問いは除外される（フォールバックで再候補化）", () => {
    const r = selectQuestion(questions, broadcasts, {
      recent: ["a1", "a2", "b1"],
      ctx: weekdayDaytime,
      now: new Date("2026-06-12T14:00:00Z"),
      random: mulberry32(7),
    });
    // 平日昼の候補は a1,a2,b1 のみ。全部 recent → フォールバックで再び候補化されるため null にはならない。
    expect(r).not.toBeNull();
  });

  it("候補が空でなければ必ず1問返す", () => {
    const r = selectQuestion(questions, broadcasts, {
      recent: [],
      ctx: midnight,
      now: new Date("2026-06-12T14:00:00Z"),
      random: mulberry32(3),
    });
    expect(r).not.toBeNull();
  });

  it("一斉配信が有効ならそれを返す（broadcast=true・recent無視）", () => {
    const activeBroadcasts: BroadcastRow[] = [
      { id: "bc1", question_id: "b1", from_at: "2026-06-12T00:00:00Z", to_at: "2026-06-12T23:59:59Z" },
    ];
    const r = selectQuestion(questions, activeBroadcasts, {
      recent: ["b1"],
      ctx: weekdayDaytime,
      now: new Date("2026-06-12T14:00:00Z"),
      random: mulberry32(1),
    });
    expect(r).not.toBeNull();
    expect(r!.question.id).toBe("b1");
    expect(r!.broadcast).toBe(true);
  });

  it("一斉配信が期間外なら通常抽選", () => {
    const expiredBroadcasts: BroadcastRow[] = [
      { id: "bc1", question_id: "b1", from_at: "2026-06-01T00:00:00Z", to_at: "2026-06-02T00:00:00Z" },
    ];
    const r = selectQuestion(questions, expiredBroadcasts, {
      recent: [],
      ctx: weekdayDaytime,
      now: new Date("2026-06-12T14:00:00Z"),
      random: mulberry32(1),
    });
    expect(r!.broadcast).toBe(false);
  });
});

describe("activeBroadcastQuestion", () => {
  it("期間内のスロットの問いを返す", () => {
    const bs: BroadcastRow[] = [
      { id: "bc1", question_id: "a1", from_at: "2026-06-12T00:00:00Z", to_at: "2026-06-13T00:00:00Z" },
    ];
    expect(activeBroadcastQuestion(questions, bs, new Date("2026-06-12T12:00:00Z"))?.id).toBe("a1");
  });
  it("該当なしは null", () => {
    expect(activeBroadcastQuestion(questions, [], new Date())).toBeNull();
  });
});
