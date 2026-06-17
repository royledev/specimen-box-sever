// API 契約・ドメイン型（specimen-box-server ADR-0004 / ADR-0006）。

/** Workers バインディング・環境変数（wrangler.jsonc と対応）。 */
export interface Env {
  /** D1 メタデータDB（問い・画像メタ）。 */
  DB: D1Database;
  /** 画像バイト R2（任意。bytes 取得補助に使う）。 */
  IMAGES?: R2Bucket;
  /** レート制限カウンタ（任意。未バインド時はレート制限を skip）。 */
  RATE_LIMIT?: KVNamespace;

  /** フォールバック画像CDN URL（dev/test 専用。prod は署名URL）。 */
  IMAGE_CDN_BASE?: string;
  /** R2 プリサイン用 Cloudflare Account ID。 */
  R2_ACCOUNT_ID?: string;
  /** R2 API アクセスキーID。 */
  R2_ACCESS_KEY_ID?: string;
  /** R2 API シークレットキー。 */
  R2_SECRET_ACCESS_KEY?: string;
  /** R2 バケット名。 */
  R2_BUCKET?: string;
  /** 署名URL TTL（秒）。未設定時は 300。 */
  IMAGE_URL_TTL_SEC?: string;
  /** 実行環境識別。"production" のとき presign creds 必須アサートを行う。 */
  ENVIRONMENT?: string;
  /** APIキー（任意。設定時は X-App-Key ヘッダーを要求）。 */
  APP_API_KEY?: string;
  /** レート制限最大カウント（best-effort）。 */
  RATE_LIMIT_MAX?: string;
  /** レート制限ウィンドウ（秒）。 */
  RATE_LIMIT_WINDOW_SEC?: string;
  /** answers エンドポイント IP レート制限最大カウント（ADR-0007）。 */
  ANSWERS_RATE_LIMIT_MAX?: string;
  /** answers エンドポイント IP レート制限ウィンドウ（秒）（ADR-0007）。 */
  ANSWERS_RATE_LIMIT_WINDOW_SEC?: string;
}

export type QuestionCondition = null | "midnightOnly" | "weekendOnly";

// --- /v1/questions/next ---
export interface QuestionsNextResponse {
  question: {
    id: string;
    text: string;
    category: string;
    condition: string | null;
  };
  broadcast: boolean;
}

// --- /v1/images/draw ---
export interface ImageRef {
  id: string;
  url: string;
  /** 表示名（日本語・例「怒った扇風機」）。生成時に確定する（ADR-0010）。 */
  name: string;
  format: string;
  width: number;
  height: number;
  bytes?: number;
  /** レア度（1=★1 〜 5=★5）。見た目に反映され、生成時に確定する（ADR-0009）。 */
  rarity: number;
}
export interface ImagesDrawResponse {
  image: ImageRef | null;
  exhausted: boolean;
}
