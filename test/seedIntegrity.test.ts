// seed 整合性テスト（再発防止）。
// - migrations/*.sql に INSERT が一切含まれないこと（migration は schema 専用 / seed 混入防止）
// - seeds/dev/images.sql が DELETE FROM images で始まること
// - seeds/dev/questions.sql が DELETE FROM questions で始まること
// - seeds/dev/questions.sql に client questions.json の 23 id が全て含まれること（id 契約）
// これらを CI で保証することで「seed が migration に紛れ本番に誤投入」「idx 衝突」「問い欠損」を防ぐ。
//
// NOTE: このテストは Node.js (vitest) 環境で実行されるため
//       fs/path モジュールを使用する。型チェックは @ts-ignore で回避している。

/* eslint-disable */
// @ts-nocheck
import { describe, it, expect } from "vitest";
import { allocateRarities } from "../src/lib/rarity";

function firstStatement(sql: string): string {
  const nonComment = sql
    .split("\n")
    .filter((line: string) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("--");
    });
  return (nonComment[0] as string | undefined)?.trim() ?? "";
}

describe("migrations は schema 専用（seed 混入の再発防止）", () => {
  it("migrations/*.sql に INSERT が一切含まれないこと", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
    const dir = join(repoRoot, "migrations");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql"));
    expect(files.length, "migrations/*.sql が見つかりません").toBeGreaterThan(0);
    const offenders = files.filter((f: string) =>
      /INSERT\s+(OR\s+IGNORE\s+)?INTO\b/i.test(readFileSync(join(dir, f), "utf-8")),
    );
    expect(
      offenders,
      `migration に INSERT が含まれています（seed は seeds/ へ移すこと）: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("dev seed 整合性（idx UNIQUE 衝突・問い欠損の再発防止）", () => {
  it("seeds/dev/images.sql の先頭（コメント除く）が DELETE FROM images であること", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
    const sql = readFileSync(join(repoRoot, "seeds", "dev", "images.sql"), "utf-8") as string;
    expect(
      firstStatement(sql).toUpperCase().startsWith("DELETE FROM IMAGES"),
      `seeds/dev/images.sql の最初のSQL文が DELETE FROM images で始まっていません: "${firstStatement(sql)}"`,
    ).toBe(true);
  });
});

describe("dev questions シード整合性（client 契約・seeds/dev/questions.sql）", () => {
  // dev seed は client specimen-box の assets/questions/questions.json と一致する（id 契約）。
  // 本番 seeds/prod/questions.sql は将来 1000 問へ拡張するため、ここでは検証対象にしない。
  async function readQ() {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
    const sql = readFileSync(join(repoRoot, "seeds", "dev", "questions.sql"), "utf-8") as string;
    const questionsJson = JSON.parse(
      readFileSync(
        join(repoRoot, "..", "specimen-box", "assets", "questions", "questions.json"),
        "utf-8",
      ) as string,
    );
    return { sql, questionsJson };
  }

  it("seeds/dev/questions.sql の先頭（コメント除く）が DELETE FROM questions であること", async () => {
    const { sql } = await readQ();
    expect(
      firstStatement(sql).toUpperCase().startsWith("DELETE FROM QUESTIONS"),
      `seeds/dev/questions.sql の最初のSQL文が DELETE FROM questions で始まっていません: "${firstStatement(sql)}"`,
    ).toBe(true);
  });

  it("seeds/dev/questions.sql が questions.json の全 23 id を含むこと", async () => {
    const { sql, questionsJson } = await readQ();
    const expectedIds: string[] = questionsJson.questions.map((q: { id: string }) => q.id);
    expect(expectedIds.length, "questions.json の問い数が 23 ではありません").toBe(23);
    const missingIds = expectedIds.filter((id: string) => !sql.includes(id));
    expect(
      missingIds,
      `seeds/dev/questions.sql に以下の id が含まれていません: ${missingIds.join(", ")}`,
    ).toEqual([]);
  });

  it("seeds/dev/questions.sql に questions.json の 23 問と同数の INSERT 行が含まれること", async () => {
    const { sql } = await readQ();
    // 各 INSERT VALUES の行（'q-で始まるIDを含む行）をカウント
    const insertLines = sql
      .split("\n")
      .filter((line: string) => /'q-[a-z]/.test(line));

    expect(
      insertLines.length,
      `seeds/dev/questions.sql の INSERT 行数が 23 ではありません（実際: ${insertLines.length}）`,
    ).toBe(23);
  });
});

describe("レア度シード整合（ADR-0009: マニフェスト = 真実の源）", () => {
  // ADR-0009 では rarity は生成パイプラインがクォータ配分でマニフェストに記録し、
  // seed/import はそれを信頼して投入する。よって seed の rarity は
  // (a) マニフェストの rarity と完全一致し、(b) その分布は allocateRarities と一致する。

  async function readManifestAndSeed() {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const repoRoot = join(__filename, "..", "..");

    const manifest = JSON.parse(
      readFileSync(
        join(repoRoot, "tools", "dummy-images", "manifest.json"),
        "utf-8",
      ),
    );
    const sql = readFileSync(
      join(repoRoot, "seeds", "dev", "images.sql"),
      "utf-8",
    ) as string;

    // 各 VALUES 行: ('<uuid>', idx, '<r2>', '<fmt>', w, h, bytes, 'active', <rarity>, '<name>')
    // name は単一引用符を '' でエスケープしうる（ADR-0010）→ (?:[^']|'')* で許容。
    const rowRe =
      /\('([0-9a-f-]{36})',\s*\d+,\s*'[^']*',\s*'[^']*',\s*\d+,\s*\d+,\s*\d+,\s*'active',\s*(\d),\s*'((?:[^']|'')*)'\)/g;
    const seedRarity = new Map<string, number>();
    const seedName = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(sql)) !== null) {
      seedRarity.set(m[1], Number(m[2]));
      seedName.set(m[1], m[3].replace(/''/g, "'")); // エスケープを戻す
    }
    return { manifest, seedRarity, seedName };
  }

  it("seeds/dev/images.sql の各 image_id の rarity がマニフェストと一致すること", async () => {
    const { manifest, seedRarity } = await readManifestAndSeed();
    expect(seedRarity.size).toBe(manifest.length);
    for (const row of manifest) {
      expect(
        seedRarity.get(row.image_id),
        `rarity mismatch for ${row.image_id}`,
      ).toBe(row.rarity);
    }
  });

  it("seeds/dev/images.sql の各 image_id の name がマニフェストと一致すること（ADR-0010）", async () => {
    const { manifest, seedName } = await readManifestAndSeed();
    expect(seedName.size).toBe(manifest.length);
    for (const row of manifest) {
      expect(
        seedName.get(row.image_id),
        `name mismatch for ${row.image_id}`,
      ).toBe(row.name);
    }
  });

  it("マニフェストの rarity 分布が allocateRarities(枚数) と一致すること", async () => {
    const { manifest } = await readManifestAndSeed();
    const expected = allocateRarities(manifest.length)
      .slice()
      .sort((a, b) => a - b);
    const actual = manifest
      .map((r: { rarity: number }) => r.rarity)
      .slice()
      .sort((a: number, b: number) => a - b);
    expect(actual).toEqual(expected);
  });
});

describe("ワードリスト整合（ADR-0011: names.json = 真実の源）", () => {
  const NAME_MAX = 80; // gen-seed.mjs / gen-import-sql.mjs / generate.py と揃える。

  async function readNames() {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const repoRoot = join(__filename, "..", "..");
    return JSON.parse(
      readFileSync(join(repoRoot, "tools", "generate", "names.json"), "utf-8"),
    );
  }

  it("各エントリが {name, prompt_en} を満たす（name 1..80・制御文字なし / prompt_en 非空）", async () => {
    const list = await readNames();
    expect(Array.isArray(list) && list.length > 0).toBe(true);
    for (const [i, row] of list.entries()) {
      expect(typeof row.name, `names[${i}].name`).toBe("string");
      expect(row.name.length >= 1 && row.name.length <= NAME_MAX, `names[${i}].name len`).toBe(true);
      // 制御文字（C0 + DEL）を name / prompt_en とも含まない。
      expect(/[\x00-\x1f\x7f]/.test(row.name), `names[${i}].name control char`).toBe(false);
      expect(typeof row.prompt_en === "string" && row.prompt_en.trim().length > 0, `names[${i}].prompt_en`).toBe(true);
      expect(/[\x00-\x1f\x7f]/.test(row.prompt_en), `names[${i}].prompt_en control char`).toBe(false);
    }
  });

  it("name は一意（完全一致重複なし）", async () => {
    const list = await readNames();
    const names = list.map((r: { name: string }) => r.name);
    const dups = names.filter((n: string, i: number) => names.indexOf(n) !== i);
    expect(dups, `重複した name: ${[...new Set(dups)].join(", ")}`).toEqual([]);
  });

  it("ダミー16枚の name が names.json 先頭16件と一致する（真実の源の一本化）", async () => {
    const list = await readNames();
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
    const manifest = JSON.parse(readFileSync(join(repoRoot, "tools", "dummy-images", "manifest.json"), "utf-8"));
    const head = list.slice(0, manifest.length).map((r: { name: string }) => r.name);
    const dummyNames = manifest.map((r: { name: string }) => r.name);
    expect(dummyNames).toEqual(head);
  });
});
