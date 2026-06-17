// レート制限のテスト（KVスタブ注入）。
import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../src/lib/rateLimit";

/** KVNamespace のシンプルなインメモリスタブ。 */
function makeKvStub(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cursor: undefined } as unknown as KVNamespaceListResult<unknown, string>;
    },
    async getWithMetadata() {
      return { value: null, metadata: null };
    },
  } as unknown as KVNamespace;
}

/** 例外を投げる壊れた KV スタブ。 */
function makeBrokenKv(): KVNamespace {
  return {
    async get() { throw new Error("KV connection error"); },
    async put() { throw new Error("KV connection error"); },
  } as unknown as KVNamespace;
}

// 固定窓テストで使う時刻定数（秒）。
// window=60 の場合 bucket = floor(t/60)。bucket=100 → t=6000..6059。
const WINDOW_SEC = 60;
const BUCKET_100_START = 100 * WINDOW_SEC; // 6000

describe("checkRateLimit", () => {
  it("KV 未バインド（undefined）は ok=true（skip）", async () => {
    const result = await checkRateLimit(undefined, "tok:test", 60, WINDOW_SEC);
    expect(result.ok).toBe(true);
  });

  it("カウント < max なら ok=true", async () => {
    // 固定窓キー形式: rl:<key>:<bucket>。bucket=floor(nowSec/window)=100。
    const kv = makeKvStub({ [`rl:tok:user1:${BUCKET_100_START / WINDOW_SEC}`]: "5" });
    const result = await checkRateLimit(kv, "tok:user1", 60, WINDOW_SEC, BUCKET_100_START);
    expect(result.ok).toBe(true);
  });

  it("カウント >= max なら ok=false・retryAfter 付き", async () => {
    const kv = makeKvStub({ [`rl:tok:user1:${BUCKET_100_START / WINDOW_SEC}`]: "60" });
    const result = await checkRateLimit(kv, "tok:user1", 60, WINDOW_SEC, BUCKET_100_START);
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBe(WINDOW_SEC);
  });

  it("NaN の max/windowSec はデフォルト値（60）で動作する", async () => {
    const kv = makeKvStub();
    const result = await checkRateLimit(kv, "tok:nantest", NaN, NaN, BUCKET_100_START);
    expect(result.ok).toBe(true);
  });

  it("KV 例外は fail-open（ok=true）", async () => {
    const result = await checkRateLimit(makeBrokenKv(), "tok:broken", 60, WINDOW_SEC, BUCKET_100_START);
    expect(result.ok).toBe(true);
  });

  it("固定窓: 窓内で max に達したリクエストは拒否される", async () => {
    const kv = makeKvStub();
    const max = 3;
    // 同じ時刻バケット内で max 回成功
    for (let i = 0; i < max; i++) {
      const r = await checkRateLimit(kv, "tok:fixed", max, WINDOW_SEC, BUCKET_100_START);
      expect(r.ok).toBe(true);
    }
    // max+1 回目は拒否
    const denied = await checkRateLimit(kv, "tok:fixed", max, WINDOW_SEC, BUCKET_100_START);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBe(WINDOW_SEC);
  });

  it("固定窓: 窓が切り替わるとカウントがリセットされる", async () => {
    const kv = makeKvStub();
    const max = 2;
    // 窓 100 で max 回リクエスト → 拒否状態にする
    for (let i = 0; i < max; i++) {
      await checkRateLimit(kv, "tok:window", max, WINDOW_SEC, BUCKET_100_START);
    }
    const deniedInSameWindow = await checkRateLimit(kv, "tok:window", max, WINDOW_SEC, BUCKET_100_START);
    expect(deniedInSameWindow.ok).toBe(false);

    // 窓 101（次バケット）では別キーなのでカウントがゼロから始まる
    const nextWindowStart = 101 * WINDOW_SEC;
    const allowedInNextWindow = await checkRateLimit(kv, "tok:window", max, WINDOW_SEC, nextWindowStart);
    expect(allowedInNextWindow.ok).toBe(true);
  });
});
