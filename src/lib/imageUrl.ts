// 画像URLの生成（ADR-0003・ADR-0004）。
// - prod: R2 S3 presigned URL（aws4fetch）。creds 未設定は起動時エラー。
// - dev/test: creds 未設定は IMAGE_CDN_BASE ベースのフォールバックURL。

import { AwsClient } from "aws4fetch";

export interface ImageUrlEnv {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  IMAGE_URL_TTL_SEC?: string;
  IMAGE_CDN_BASE?: string;
  ENVIRONMENT?: string;
}

/** creds が完全に揃っているか。 */
function hasCreds(env: ImageUrlEnv): boolean {
  return !!(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET
  );
}

/**
 * prod 起動時アサート: ENVIRONMENT=production かつ creds 未設定はエラー。
 * `src/index.ts` の `fetch` エクスポート前に呼ぶ。
 */
export function assertProdCreds(env: ImageUrlEnv): void {
  if (env.ENVIRONMENT === "production" && !hasCreds(env)) {
    throw new Error(
      "FATAL: prod requires R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET",
    );
  }
}

/**
 * R2 画像の URL を生成する。
 * - creds 有: aws4fetch で S3 互換 presigned URL を生成（TTL=IMAGE_URL_TTL_SEC, 既定300s）。
 * - creds 無: IMAGE_CDN_BASE ベースの非署名フォールバックURL（dev/test 専用）。
 *
 * @param r2Key  R2 上のオブジェクトキー（例: img/<uuid>.webp）
 * @param env    Env からの必要フィールド
 */
export async function buildImageUrl(r2Key: string, env: ImageUrlEnv): Promise<string> {
  if (!hasCreds(env)) {
    // dev/test: フォールバック（CDN ベース＋キー）
    const base = (env.IMAGE_CDN_BASE ?? "https://cdn.example.com").replace(/\/+$/, "");
    return `${base}/${r2Key}`;
  }

  const rawTtl = Number(env.IMAGE_URL_TTL_SEC ?? "300");
  const ttl = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : 300;
  const bucket = env.R2_BUCKET!;
  const accountId = env.R2_ACCOUNT_ID!;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });

  // S3 presigned URL（GET, URL に署名を埋め込む）。
  const url = new URL(`${endpoint}/${bucket}/${r2Key}`);
  url.searchParams.set("X-Amz-Expires", String(ttl));

  const signed = await aws.sign(
    new Request(url, { method: "GET" }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}
