// ルートの統合テスト（app.request + D1スタブ注入・D1起動なし）。
import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/types";

// ダミーの questions 行。
const DUMMY_QUESTIONS = [
  { id: "q-test-01", text: "テスト問い1", category: "test", weight: 1.0, condition: null,     status: "active" },
  { id: "q-test-02", text: "テスト問い2", category: "test", weight: 1.0, condition: null,     status: "active" },
  { id: "q-test-03", text: "テスト問い3", category: "other", weight: 1.0, condition: null,    status: "active" },
];

// ダミーの images 行。
const DUMMY_IMAGES = [
  { image_id: "00000000-0000-0000-0000-000000000001", idx: 1, r2_key: "img/uuid-1.webp", format: "webp", width: 768, height: 768, bytes: 102400, status: "active", rarity: 1, name: "怒った扇風機" },
  { image_id: "00000000-0000-0000-0000-000000000002", idx: 2, r2_key: "img/uuid-2.webp", format: "webp", width: 768, height: 768, bytes: 98304,  status: "active", rarity: 3, name: "泣いているトースター" },
  { image_id: "00000000-0000-0000-0000-000000000003", idx: 3, r2_key: "img/uuid-3.webp", format: "webp", width: 768, height: 768, bytes: 115200, status: "active", rarity: 5, name: "抱きしめるサボテン" },
];

/** D1Database のインメモリスタブ。 */
function makeD1Stub(): D1Database {
  return {
    prepare(sql: string) {
      // COUNT クエリ
      if (sql.includes("COUNT(*)")) {
        return {
          first: async () => ({ n: DUMMY_IMAGES.length }),
          bind: () => ({ first: async () => ({ n: DUMMY_IMAGES.length }) }),
        };
      }
      // images: idx = ?1 クエリ
      if (sql.includes("idx = ?1")) {
        return {
          bind: (idx: number) => ({
            first: async () => DUMMY_IMAGES.find((r) => r.idx === idx) ?? null,
          }),
        };
      }
      // images: idx >= ?1 クエリ（線形フォールバック）
      if (sql.includes("idx >= ?1")) {
        return {
          bind: (startIdx: number, limit: number) => ({
            all: async () => ({
              results: DUMMY_IMAGES.filter((r) => r.idx >= startIdx).slice(0, limit),
            }),
          }),
        };
      }
      // questions クエリ
      if (sql.includes("FROM questions")) {
        return {
          all: async () => ({ results: DUMMY_QUESTIONS }),
        };
      }
      // broadcasts クエリ
      if (sql.includes("FROM broadcasts")) {
        return {
          bind: () => ({ all: async () => ({ results: [] }) }),
        };
      }
      // 未知 SQL: サイレント破綻を防ぐため throw する。
      throw new Error(`unexpected SQL: ${sql}`);
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

/** 枯渇用 D1 スタブ（全画像 owned されている状態を模擬）。 */
function makeD1ExhaustedStub(): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("COUNT(*)")) {
        return { first: async () => ({ n: 2 }) };
      }
      // どの idx でも null を返す（穴だらけ = 引き直し失敗）
      if (sql.includes("idx = ?1")) {
        return { bind: () => ({ first: async () => null }) };
      }
      // 線形も空
      if (sql.includes("idx >= ?1")) {
        return { bind: () => ({ all: async () => ({ results: [] }) }) };
      }
      if (sql.includes("FROM questions")) {
        return { all: async () => ({ results: DUMMY_QUESTIONS }) };
      }
      if (sql.includes("FROM broadcasts")) {
        return { bind: () => ({ all: async () => ({ results: [] }) }) };
      }
      // 未知 SQL: サイレント破綻を防ぐため throw する。
      throw new Error(`unexpected SQL: ${sql}`);
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

const baseEnv: Env = {
  DB: makeD1Stub(),
  IMAGE_CDN_BASE: "https://cdn.test",
  ENVIRONMENT: "development",
};

function post(path: string, body: unknown, e: Env = baseEnv) {
  return app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    e,
  );
}

describe("GET /health", () => {
  it("ok", async () => {
    const res = await app.request("/health", {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /v1/questions/next", () => {
  it("正常系: 問いを1問返す", async () => {
    const res = await post("/v1/questions/next", { recent: [], localTime: "2026-06-12T14:00:00+09:00" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof (body.question as Record<string, unknown>).id).toBe("string");
    expect(typeof (body.question as Record<string, unknown>).text).toBe("string");
    expect(body.broadcast).toBe(false);
  });

  it("localTime 不正は 400", async () => {
    const res = await post("/v1/questions/next", { recent: [], localTime: "nope" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });

  it("recent 省略でも default で動く", async () => {
    const res = await post("/v1/questions/next", { localTime: "2026-06-12T14:00:00+09:00" });
    expect(res.status).toBe(200);
  });

  it("非JSONボディは 400", async () => {
    const res = await app.request(
      "/v1/questions/next",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      baseEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });

  it("配列ボディは 400", async () => {
    const res = await app.request(
      "/v1/questions/next",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" },
      baseEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });
});

describe("POST /v1/images/draw", () => {
  it("正常系: image とURLを返す（UUID形式）", async () => {
    const res = await post("/v1/images/draw", { owned: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.exhausted).toBe(false);
    const image = body.image as Record<string, unknown>;
    expect(typeof image.id).toBe("string");
    // UUID は 8-4-4-4-12 のハイフン区切り。
    expect(image.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof image.url).toBe("string");
    expect(image.width).toBe(768);
    // bytes は D1 の値。
    expect(typeof image.bytes).toBe("number");
  });

  it("所有済みを除外して返す", async () => {
    const res = await post("/v1/images/draw", {
      owned: [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.exhausted).toBe(false);
    const image = body.image as Record<string, unknown>;
    expect(image.id).toBe("00000000-0000-0000-0000-000000000003");
    // レア度（ADR-0009）: D1 の rarity 列がそのまま返る。
    expect(image.rarity).toBe(5);
    // 表示名（ADR-0010）: D1 の name 列がそのまま返る。
    expect(image.name).toBe("抱きしめるサボテン");
  });

  it("レア度（rarity）を返す（ADR-0009）", async () => {
    const res = await post("/v1/images/draw", {
      owned: [
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000003",
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const image = body.image as Record<string, unknown>;
    expect(image.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(image.rarity).toBe(1);
  });

  it("枯渇時は image=null・exhausted=true", async () => {
    const exhaustedEnv: Env = { ...baseEnv, DB: makeD1ExhaustedStub() };
    const res = await post("/v1/images/draw", { owned: [] }, exhaustedEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: null, exhausted: true });
  });

  it("owned 上限超過（11001件）は 400", async () => {
    const res = await post("/v1/images/draw", {
      owned: Array.from({ length: 11001 }, (_, i) => `id-${i}`),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });

  it("非JSONボディは 400", async () => {
    const res = await app.request(
      "/v1/images/draw",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "invalid" },
      baseEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });

  it("配列ボディは 400", async () => {
    const res = await app.request(
      "/v1/images/draw",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" },
      baseEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });
});

describe("APP_API_KEY ガード", () => {
  it("設定時、X-App-Key 不一致は 401", async () => {
    const guarded: Env = { ...baseEnv, APP_API_KEY: "secret" };
    const res = await app.request(
      "/v1/images/draw",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owned: [] }) },
      guarded,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  it("正しい X-App-Key では通過する", async () => {
    const guarded: Env = { ...baseEnv, APP_API_KEY: "secret" };
    const res = await app.request(
      "/v1/images/draw",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Key": "secret" },
        body: JSON.stringify({ owned: [] }),
      },
      guarded,
    );
    expect(res.status).toBe(200);
  });
});

describe("未知ルート", () => {
  it("404", async () => {
    const res = await app.request("/v1/unknown", {}, baseEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });
});

describe("レート制限", () => {
  it("KV 未バインドはスキップ（200を返す）", async () => {
    const envNoKv: Env = { ...baseEnv, RATE_LIMIT: undefined };
    const res = await post("/v1/questions/next", { localTime: "2026-06-12T14:00:00+09:00" }, envNoKv);
    expect(res.status).toBe(200);
  });
});

describe("broadcasts はサーバー時刻で判定される", () => {
  it("D1 が broadcasts を返す場合、localTime が過去でも broadcast=true になる（サーバー時刻判定）", async () => {
    // broadcasts を返すスタブ: question_id=q-test-01 の有効な broadcast を返す。
    // from_at/to_at は意図的にサーバー時刻（現在）が含まれる広い窓にする。
    const broadcastQ = DUMMY_QUESTIONS[0]; // q-test-01
    const from = new Date(Date.now() - 3600 * 1000).toISOString(); // 1時間前
    const to   = new Date(Date.now() + 3600 * 1000).toISOString(); // 1時間後
    const broadcastRow = { id: "bcast-test-01", question_id: broadcastQ.id, from_at: from, to_at: to };

    const dbWithBroadcast: D1Database = {
      prepare(sql: string) {
        if (sql.includes("FROM questions")) {
          return { all: async () => ({ results: DUMMY_QUESTIONS }) };
        }
        if (sql.includes("FROM broadcasts")) {
          // サーバー時刻で問い合わせるので、ここで返した行はサーバー時刻で有効。
          return { bind: () => ({ all: async () => ({ results: [broadcastRow] }) }) };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
      dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;

    const envWithBroadcast: Env = { ...baseEnv, DB: dbWithBroadcast };
    // localTime は古い時刻（端末が過去の時刻を申告）
    const res = await post(
      "/v1/questions/next",
      { recent: [], localTime: "2020-01-01T00:00:00+09:00" },
      envWithBroadcast,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // broadcasts はサーバー時刻で有効なので broadcast=true が返るはず。
    expect(body.broadcast).toBe(true);
    expect((body.question as Record<string, unknown>).id).toBe(broadcastQ.id);
  });
});

describe("D1 例外は database_error 500 になる", () => {
  it("questions クエリが D1Error を投げると 500・error=database_error", async () => {
    const dbFailing: D1Database = {
      prepare(sql: string) {
        if (sql.includes("FROM questions")) {
          return {
            all: async () => { throw new Error("D1_ERROR: simulated D1 failure"); },
          };
        }
        if (sql.includes("FROM broadcasts")) {
          return { bind: () => ({ all: async () => ({ results: [] }) }) };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
      dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;

    const envFailing: Env = { ...baseEnv, DB: dbFailing };
    const res = await post(
      "/v1/questions/next",
      { recent: [], localTime: "2026-06-12T14:00:00+09:00" },
      envFailing,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("database_error");
  });
});
