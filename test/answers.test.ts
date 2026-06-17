// POST /v1/answers のテスト（ADR-0007: 匿名・非連結）。
// D1/KV スタブ注入・app.request を使用（実 D1 不要）。
import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/types";

// --- スタブ ---

/** INSERT を捕捉する D1 スタブ。inserted に実行 SQL と引数を記録する。 */
function makeD1Stub() {
  const inserted: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      // answers INSERT
      if (sql.includes("INSERT INTO answers")) {
        return {
          bind(...params: unknown[]) {
            return {
              async run() {
                inserted.push({ sql, params });
              },
            };
          },
        };
      }
      // 他のクエリは答えない（answers ルートは questions/images を叩かない）
      throw new Error(`unexpected SQL in answers test: ${sql}`);
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;

  return { db, inserted };
}

/** シンプルなインメモリ KV スタブ。 */
function makeKvStub(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [], list_complete: true, cursor: undefined } as unknown as KVNamespaceListResult<unknown, string>; },
    async getWithMetadata() { return { value: null, metadata: null }; },
  } as unknown as KVNamespace;
}

/** 例外を投げる壊れた KV スタブ（fail-open 検証用）。 */
function makeBrokenKv(): KVNamespace {
  return {
    async get() { throw new Error("KV connection error"); },
    async put() { throw new Error("KV connection error"); },
  } as unknown as KVNamespace;
}

/** 例外を投げる壊れた D1 スタブ（fail-open 検証用）。 */
function makeBrokenD1(): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("INSERT INTO answers")) {
        return {
          bind() {
            return {
              async run() { throw new Error("D1 connection error"); },
            };
          },
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function makeBaseEnv(overrides: Partial<Env> = {}): Env {
  const { db } = makeD1Stub();
  return {
    DB: db,
    ENVIRONMENT: "development",
    ANSWERS_RATE_LIMIT_MAX: "10",
    ANSWERS_RATE_LIMIT_WINDOW_SEC: "60",
    ...overrides,
  };
}

function postAnswers(body: unknown, env: Env, extraHeaders: Record<string, string> = {}) {
  return app.request(
    "/v1/answers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    },
    env,
  );
}

// --- テスト ---

describe("POST /v1/answers 正常系", () => {
  it("正常なリクエストは 202 + { ok: true } を返す", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers(
      { questionId: "q-meaningless-01", answerText: "smoke test" },
      env,
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("X-Device-Token を送っても 202 が返る（トークン非読取）", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers(
      { questionId: "q-meaningless-01", answerText: "test" },
      env,
      { "X-Device-Token": "dummy-token-should-be-ignored" },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /v1/answers 非連結保存形の担保", () => {
  it("insertAnswer に渡る列が question_id・answer_text・day のみ（IP/token/精密時刻なし）", async () => {
    const { db, inserted } = makeD1Stub();
    const env = makeBaseEnv({ DB: db });
    const res = await postAnswers(
      { questionId: "q-sound-01", answerText: "test answer" },
      env,
    );
    expect(res.status).toBe(202);
    expect(inserted).toHaveLength(1);
    const { sql, params } = inserted[0];
    // SQL に id・question_id・answer_text・day のみが含まれること（IP/token/精密時刻なし）
    expect(sql).toContain("INSERT INTO answers(id, question_id, answer_text, day)");
    // params は [id, questionId, answerText, day] の4つのみ
    expect(params).toHaveLength(4);
    // id はランダム UUIDv4（連番でない・タイムスタンプを埋め込まない＝匿名）
    expect(params[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(params[1]).toBe("q-sound-01");
    expect(params[2]).toBe("test answer");
    // day は UTC yyyymmdd 形式（8桁数字）
    expect(typeof params[3]).toBe("string");
    expect(params[3]).toMatch(/^\d{8}$/);
  });

  it("X-Device-Token を送っても保存値に現れない", async () => {
    const { db, inserted } = makeD1Stub();
    const env = makeBaseEnv({ DB: db });
    await postAnswers(
      { questionId: "q-object-01", answerText: "my answer" },
      env,
      { "X-Device-Token": "super-secret-token-xyz" },
    );
    expect(inserted).toHaveLength(1);
    const { params } = inserted[0];
    // 4パラメータのみ（id, question_id, answer_text, day）・トークン文字列が含まれない
    expect(params).toHaveLength(4);
    const paramsStr = JSON.stringify(params);
    expect(paramsStr).not.toContain("super-secret-token-xyz");
  });

  it("day が UTC yyyymmdd 形式（8桁数字）", async () => {
    const { db, inserted } = makeD1Stub();
    const env = makeBaseEnv({ DB: db });
    await postAnswers(
      { questionId: "q-body-01", answerText: "test" },
      env,
    );
    expect(inserted).toHaveLength(1);
    const day = inserted[0].params[3] as string;
    expect(day).toMatch(/^\d{8}$/);
    // yyyymmdd として有効な範囲か（年2020〜2099・月01-12・日01-31）
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(4, 6));
    const date = Number(day.slice(6, 8));
    expect(year).toBeGreaterThanOrEqual(2020);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(date).toBeGreaterThanOrEqual(1);
    expect(date).toBeLessThanOrEqual(31);
  });
});

describe("POST /v1/answers バリデーション 400 系", () => {
  it("questionId が空は 400", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers({ questionId: "", answerText: "ok" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("questionId が 65 文字（上限超過）は 400", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers({ questionId: "q".repeat(65), answerText: "ok" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("answerText が空は 400", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers({ questionId: "q-test", answerText: "" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("answerText が 501 文字（上限超過）は 400", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers({ questionId: "q-test", answerText: "a".repeat(501) }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("非JSON ボディは 400", async () => {
    const env = makeBaseEnv();
    const res = await app.request(
      "/v1/answers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("配列 body は 400", async () => {
    const env = makeBaseEnv();
    const res = await app.request(
      "/v1/answers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("questionId が数値型は 400", async () => {
    const env = makeBaseEnv();
    const res = await postAnswers({ questionId: 123, answerText: "ok" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("invalid_request");
  });
});

describe("POST /v1/answers IP レート制限 429", () => {
  it("IP レート超過で 429 + Retry-After ヘッダ", async () => {
    // ANSWERS_RATE_LIMIT_MAX=1 に設定し、1回目はOK・2回目は429になるはず。
    // 同一 bucket 内で超過させるため nowSec を固定する（KV スタブで bucket を一致させる）。
    const kv = makeKvStub();
    // bucket=floor(nowSec/60)。任意の nowSec でテスト。
    // max=1 に設定して1回で超過させる。
    const env = makeBaseEnv({
      RATE_LIMIT: kv,
      ANSWERS_RATE_LIMIT_MAX: "1",
      ANSWERS_RATE_LIMIT_WINDOW_SEC: "60",
    });
    const body = { questionId: "q-test", answerText: "test" };

    // 1回目: 通過
    const res1 = await postAnswers(body, env, { "CF-Connecting-IP": "1.2.3.4" });
    expect(res1.status).toBe(202);

    // 2回目: 429
    const res2 = await postAnswers(body, env, { "CF-Connecting-IP": "1.2.3.4" });
    expect(res2.status).toBe(429);
    expect(((await res2.json()) as Record<string, unknown>).error).toBe("rate_limited");
    expect(res2.headers.get("Retry-After")).not.toBeNull();
  });

  it("KV 未バインドはレート制限スキップ（202）", async () => {
    const env = makeBaseEnv({ RATE_LIMIT: undefined });
    const res = await postAnswers({ questionId: "q-test", answerText: "test" }, env);
    expect(res.status).toBe(202);
  });
});

describe("POST /v1/answers スコープ分離: rateLimitMw（token 鍵）は answers に波及しない", () => {
  it("RATE_LIMIT バインド済み・X-Device-Token 付き・MAX 超の連投でも 429 にならない（tok バケット不使用）", async () => {
    // rateLimitMw は RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_SEC を読む。
    // MAX=1 に設定し2回以上同一トークンで投げても answers は 429 にならないことを確認。
    const kv = makeKvStub();
    const env: Env = {
      ...makeBaseEnv({ RATE_LIMIT: kv }),
      // rateLimitMw が存在すれば使うパラメータ。answers ルートはこれを参照しない。
      RATE_LIMIT_MAX: "1",
      RATE_LIMIT_WINDOW_SEC: "60",
      // answers 側の IP 制限は大きく設定して answers 自身の 429 が起きないようにする
      ANSWERS_RATE_LIMIT_MAX: "100",
      ANSWERS_RATE_LIMIT_WINDOW_SEC: "60",
    };
    const body = { questionId: "q-scope-test", answerText: "test" };

    // 同一トークンで3回投げる（rateLimitMw が波及していれば2回目以降で 429）
    const res1 = await postAnswers(body, env, { "X-Device-Token": "scope-test-token" });
    const res2 = await postAnswers(body, env, { "X-Device-Token": "scope-test-token" });
    const res3 = await postAnswers(body, env, { "X-Device-Token": "scope-test-token" });
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(res3.status).toBe(202);
  });

  it("RATE_LIMIT バインド済みでも KV に tok: キーが書かれない（token 鍵バケット不使用）", async () => {
    // rateLimitMw が answers に波及していると KV に `rl:tok:<token>:<bucket>` が書かれる。
    // answers ルートは tok: キーを一切書かないことを確認する。
    const kv = makeKvStub();
    const env = makeBaseEnv({
      RATE_LIMIT: kv,
      ANSWERS_RATE_LIMIT_MAX: "100",
    });
    const token = "probe-token-xyz";
    await postAnswers(
      { questionId: "q-probe", answerText: "probe" },
      env,
      { "X-Device-Token": token },
    );
    // KV store のキーを検査。tok: を含むキーが存在しないことを確認。
    // makeKvStub の store は Map なので直接参照できる。
    // しかし外部から store にアクセスできないので、
    // kv.get で tok: プレフィックスのキーを直接試みる（バケット番号を推測）。
    // 代わりに: kv 自体を spy 可能なスタブに拡張して呼び出しを記録する。
    // ここでは put 呼び出しを記録するスタブで確認する。
    const writtenKeys: string[] = [];
    const spyKv: KVNamespace = {
      async get(_key: string) { return null; },
      async put(key: string, _value: string) { writtenKeys.push(key); },
      async delete(_key: string) { /* noop */ },
      async list() { return { keys: [], list_complete: true, cursor: undefined } as unknown as KVNamespaceListResult<unknown, string>; },
      async getWithMetadata() { return { value: null, metadata: null }; },
    } as unknown as KVNamespace;

    const envWithSpy = makeBaseEnv({
      RATE_LIMIT: spyKv,
      ANSWERS_RATE_LIMIT_MAX: "100",
    });
    await postAnswers(
      { questionId: "q-probe", answerText: "probe" },
      envWithSpy,
      { "X-Device-Token": token },
    );
    // answers ルートが書くキーは `rl:ans:ip:...` のみ。`rl:tok:` は書かれない。
    const tokKeys = writtenKeys.filter((k) => k.startsWith("rl:tok:"));
    expect(tokKeys).toHaveLength(0);
    // ans:ip: キーは書かれているはず（IP ベースの answers 専用制限）
    const ansIpKeys = writtenKeys.filter((k) => k.startsWith("rl:ans:ip:"));
    expect(ansIpKeys.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /v1/answers fail-open", () => {
  it("KV 例外でもレート制限は fail-open（202）", async () => {
    const env = makeBaseEnv({ RATE_LIMIT: makeBrokenKv() });
    const res = await postAnswers({ questionId: "q-test", answerText: "test" }, env);
    expect(res.status).toBe(202);
  });

  it("D1 例外でも fail-open（202）", async () => {
    const env = makeBaseEnv({ DB: makeBrokenD1() });
    const res = await postAnswers({ questionId: "q-test", answerText: "test" }, env);
    expect(res.status).toBe(202);
  });
});
