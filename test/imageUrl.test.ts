// 署名URL生成のテスト。
import { describe, it, expect } from "vitest";
import { buildImageUrl, assertProdCreds } from "../src/lib/imageUrl";

describe("buildImageUrl", () => {
  it("creds 未設定: IMAGE_CDN_BASE ベースのフォールバック URL を返す", async () => {
    const url = await buildImageUrl("img/some-uuid.webp", {
      IMAGE_CDN_BASE: "https://cdn.example.com",
    });
    expect(url).toBe("https://cdn.example.com/img/some-uuid.webp");
  });

  it("creds 未設定: IMAGE_CDN_BASE 末尾スラッシュを正規化", async () => {
    const url = await buildImageUrl("img/some-uuid.webp", {
      IMAGE_CDN_BASE: "https://cdn.example.com/",
    });
    expect(url).toBe("https://cdn.example.com/img/some-uuid.webp");
  });

  it("creds 未設定かつ CDN_BASE も未設定: デフォルト CDN を使う", async () => {
    const url = await buildImageUrl("img/some-uuid.webp", {});
    expect(url).toContain("img/some-uuid.webp");
  });

  it("creds 全揃い: presigned URL を返す（Amz クエリパラメータ含む）", async () => {
    const url = await buildImageUrl("img/test.webp", {
      R2_ACCOUNT_ID: "test-account-id",
      R2_ACCESS_KEY_ID: "test-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET: "test-bucket",
      IMAGE_URL_TTL_SEC: "300",
    });
    // presigned URL には X-Amz-Signature か X-Amz-Credential が含まれる。
    expect(url).toMatch(/X-Amz-/);
    expect(url).toContain("test.webp");
  });
});

describe("assertProdCreds", () => {
  it("ENVIRONMENT=production かつ creds 未設定でエラー", () => {
    expect(() =>
      assertProdCreds({ ENVIRONMENT: "production" }),
    ).toThrow("FATAL:");
  });

  it("ENVIRONMENT=production かつ creds 揃いでエラーなし", () => {
    expect(() =>
      assertProdCreds({
        ENVIRONMENT: "production",
        R2_ACCOUNT_ID: "a",
        R2_ACCESS_KEY_ID: "b",
        R2_SECRET_ACCESS_KEY: "c",
        R2_BUCKET: "d",
      }),
    ).not.toThrow();
  });

  it("ENVIRONMENT=development は creds 不要", () => {
    expect(() =>
      assertProdCreds({ ENVIRONMENT: "development" }),
    ).not.toThrow();
  });

  it("ENVIRONMENT 未設定は creds 不要", () => {
    expect(() => assertProdCreds({})).not.toThrow();
  });
});
