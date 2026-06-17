import { describe, it, expect } from "vitest";
import { localContextFromISO } from "../src/lib/time";

describe("localContextFromISO", () => {
  it("オフセット付き ISO の壁時計の時を読む（UTC変換しない）", () => {
    expect(localContextFromISO("2026-06-12T23:40:00+09:00").hour).toBe(23);
    expect(localContextFromISO("2026-06-12T02:00:00-05:00").hour).toBe(2);
  });

  it("曜日判定（2026-06-13 は土曜）", () => {
    expect(localContextFromISO("2026-06-13T10:00:00+09:00").isWeekend).toBe(true); // Sat
    expect(localContextFromISO("2026-06-14T10:00:00+09:00").isWeekend).toBe(true); // Sun
    expect(localContextFromISO("2026-06-12T10:00:00+09:00").isWeekend).toBe(false); // Fri
  });

  it("不正な文字列は例外", () => {
    expect(() => localContextFromISO("not-a-date")).toThrow();
  });
});
