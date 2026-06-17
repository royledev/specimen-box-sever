// dev 画像配信ルートのテスト（T7）。
// devImages: dev=R2スタブからバイト+Content-Type返却 / production=404 / 未存在key=404

import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/types";

/** R2 オブジェクトのスタブを作る。 */
function makeR2Object(bytes: Uint8Array, contentType?: string): R2Object {
  return {
    key: "stub-key",
    version: "v1",
    size: bytes.length,
    etag: "stub-etag",
    httpEtag: `"stub-etag"`,
    checksums: {},
    uploaded: new Date(),
    httpMetadata: contentType ? { contentType } : undefined,
    customMetadata: {},
    range: { offset: 0, length: bytes.length },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    text: async () => new TextDecoder().decode(bytes),
    json: async () => ({}),
    blob: async () => new Blob([bytes]),
    writeHttpMetadata: () => {},
  } as unknown as R2Object;
}

/** R2Bucket スタブを作る。 */
function makeR2Stub(
  store: Map<string, Uint8Array>,
  contentTypeMap?: Map<string, string>,
): R2Bucket {
  return {
    get: async (key: string) => {
      const data = store.get(key);
      if (data === undefined) return null;
      const ct = contentTypeMap?.get(key);
      return makeR2Object(data, ct);
    },
    head: async () => null,
    put: async () => ({}) as unknown as R2Object,
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    createMultipartUpload: async () => ({}) as unknown as R2MultipartUpload,
    resumeMultipartUpload: async () => ({}) as unknown as R2MultipartUpload,
  } as unknown as R2Bucket;
}

// ベース Env（dev 環境）
const devBaseEnv: Env = {
  DB: {} as D1Database,
  ENVIRONMENT: "development",
  IMAGE_CDN_BASE: "http://localhost:8787/dev/img",
};

// prod 環境（prod テストは creds 必須なので揃えておく）
const prodEnv: Env = {
  DB: {} as D1Database,
  ENVIRONMENT: "production",
  R2_ACCOUNT_ID: "test-account-id",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET: "test-bucket",
};

describe("GET /dev/img/<key>", () => {
  it("dev 環境: R2 スタブから PNG バイトと Content-Type を返す", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG マジックバイト
    const store = new Map([["img/test-image.png", pngBytes]]);
    const r2 = makeR2Stub(store, new Map([["img/test-image.png", "image/png"]]));

    const env: Env = { ...devBaseEnv, IMAGES: r2 };
    const res = await app.request("/dev/img/img/test-image.png", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const body = await res.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(pngBytes);
  });

  it("dev 環境: httpMetadata.contentType がなければ拡張子から Content-Type を解決", async () => {
    const pngBytes = new Uint8Array([1, 2, 3, 4]);
    const store = new Map([["img/no-ct.png", pngBytes]]);
    // contentTypeMap に含めない → httpMetadata.contentType = undefined
    const r2 = makeR2Stub(store);

    const env: Env = { ...devBaseEnv, IMAGES: r2 };
    const res = await app.request("/dev/img/img/no-ct.png", {}, env);

    expect(res.status).toBe(200);
    // 拡張子 .png → image/png
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  it("dev 環境: 存在しない key は 404", async () => {
    const store = new Map<string, Uint8Array>(); // 空
    const r2 = makeR2Stub(store);

    const env: Env = { ...devBaseEnv, IMAGES: r2 };
    const res = await app.request("/dev/img/img/not-found.png", {}, env);

    expect(res.status).toBe(404);
  });

  it("production 環境: 404 を返す", async () => {
    const pngBytes = new Uint8Array([1, 2, 3]);
    const store = new Map([["img/test.png", pngBytes]]);
    const r2 = makeR2Stub(store, new Map([["img/test.png", "image/png"]]));

    const env: Env = { ...prodEnv, IMAGES: r2 };
    const res = await app.request("/dev/img/img/test.png", {}, env);

    expect(res.status).toBe(404);
  });

  it("IMAGES バインディングなし: 404 を返す", async () => {
    const env: Env = { ...devBaseEnv, IMAGES: undefined };
    const res = await app.request("/dev/img/img/test.png", {}, env);

    expect(res.status).toBe(404);
  });

  it("webp ファイル: Content-Type = image/webp", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const store = new Map([["img/test.webp", bytes]]);
    const r2 = makeR2Stub(store);

    const env: Env = { ...devBaseEnv, IMAGES: r2 };
    const res = await app.request("/dev/img/img/test.webp", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/webp");
  });
});
