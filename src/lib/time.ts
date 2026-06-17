// 端末申告の localTime（tz オフセット付き ISO）から、ユーザーのローカル壁時計の
// 「時」と「週末か」を求める（条件問いの判定用 / ADR-0006）。
// オフセット込みの文字列の日時成分がそのままローカル壁時計なので、UTC 変換せず成分を読む。

export interface LocalContext {
  /** 0–23（ローカル時）。 */
  hour: number;
  /** 土日なら true。 */
  isWeekend: boolean;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?/;

/**
 * サーバー UTC 由来の粗い日付文字列（yyyymmdd）を返す。
 * 精密時刻を持たない（ADR-0007: フィールド最小化）。
 * @param d - テスト時に注入できる Date（省略時は new Date()）。
 */
export function utcDayStamp(d: Date = new Date()): string {
  const y = d.getUTCFullYear().toString();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${mo}${da}`;
}

export function localContextFromISO(iso: string): LocalContext {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`invalid localTime: ${iso}`);
  const [, y, mo, d, h] = m;
  const hour = Number(h);
  // 曜日はローカル日付（Y-M-D）から算出。ホストの tz に依存しないよう UTC で構築。
  const dow = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay(); // 0=Sun..6=Sat
  return { hour, isWeekend: dow === 0 || dow === 6 };
}
