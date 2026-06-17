// レート制限（best-effort / ADR-0005）。KV カウンタによる固定窓制限。
// 目的はスクレイピングを「割に合わない」程度に遅くすること（完全防止はしない）。
// KV 例外は fail-open（正常利用者を止めない）。NaN ガード済み。
//
// 固定窓方式: 鍵に時刻バケット（floor(nowSec / safeWindow)）を埋め込むことで
// リクエスト毎に TTL がリセットされる「スライドウィンドウ化」を防止する。

export interface RateLimitResult {
  ok: boolean;
  retryAfter?: number;
}

export async function checkRateLimit(
  kv: KVNamespace | undefined,
  key: string,
  max: number,
  windowSec: number,
  /** テスト時に注入できる現在時刻（秒）。省略時は Date.now()/1000。 */
  nowSec?: number,
): Promise<RateLimitResult> {
  if (!kv) return { ok: true }; // KV 未バインドなら skip

  // NaN ガード: 不正な値はデフォルト値に置き換える。
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 60;
  const safeWindow = Number.isFinite(windowSec) && windowSec > 0 ? Math.floor(windowSec) : 60;

  // 固定窓: 時刻バケットをキーに埋め込む。同窓内は同じキーを参照し続ける。
  const ts = nowSec ?? Date.now() / 1000;
  const bucket = Math.floor(ts / safeWindow);
  const bucketKey = `rl:${key}:${bucket}`;

  try {
    const current = await kv.get(bucketKey);
    const count = current ? Number(current) : 0;
    if (count >= safeMax) {
      return { ok: false, retryAfter: safeWindow };
    }
    // TTL = safeWindow に固定。窓が切り替わると新バケットへ移行し自然消滅する。
    await kv.put(bucketKey, String(count + 1), { expirationTtl: safeWindow });
    return { ok: true };
  } catch {
    // KV 例外は fail-open: 正常利用者を止めない。
    return { ok: true };
  }
}
