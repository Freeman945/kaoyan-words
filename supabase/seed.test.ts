/**
 * 验证 supabase/seed.sql 能正确导入单词。
 *
 * 【为什么值得单独测】
 * seed.sql 是由脚本生成的，内容是一大段 INSERT。它的正确性只有真的执行一遍
 * 才知道 —— 而"粘贴到 Supabase 里执行"这一步，如果出错，报错信息往往很含糊。
 * 在本地用 PGlite 先跑一遍，就能提前发现问题。
 *
 * 顺便也验证了「重复执行不会产生重复单词」—— 这是文档里对用户的承诺，
 * 必须真的成立。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = process.cwd();

function readSql(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

/** CSV 里第一版准备了 40 个测试单词 */
const EXPECTED_WORD_COUNT = 40;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(readSql("supabase/supabase-shim.sql"));
  await db.exec(readSql("supabase/schema.sql"));
  await db.exec(readSql("supabase/seed.sql"));
});

after(async () => {
  await db.close();
});

async function countWords(): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    "select count(*)::int as total from public.words",
  );
  return rows[0].total;
}

describe("seed.sql：单词导入", () => {
  it("成功导入了 40 个单词", async () => {
    assert.equal(await countWords(), EXPECTED_WORD_COUNT);
  });

  it("每个单词都有音标、词性、中文释义和例句", async () => {
    const { rows } = await db.query<{
      word: string;
      phonetic: string | null;
      part_of_speech: string | null;
      meaning: string | null;
      example: string | null;
      example_translation: string | null;
    }>(`select word, phonetic, part_of_speech, meaning, example, example_translation
        from public.words`);

    for (const row of rows) {
      assert.ok(row.phonetic, `${row.word} 缺音标`);
      assert.ok(row.part_of_speech, `${row.word} 缺词性`);
      assert.ok(row.meaning, `${row.word} 缺中文释义`);
      assert.ok(row.example, `${row.word} 缺英文例句`);
      assert.ok(row.example_translation, `${row.word} 缺例句翻译`);
    }
  });

  it("难度都在 1-5 之间", async () => {
    const { rows } = await db.query<{ bad: number }>(
      `select count(*)::int as bad from public.words
       where difficulty < 1 or difficulty > 5`,
    );
    assert.equal(rows[0].bad, 0);
  });

  it("例句里确实包含对应的单词（抽查前 10 个）", async () => {
    const { rows } = await db.query<{ word: string; example: string }>(
      "select word, example from public.words order by id limit 10",
    );

    for (const row of rows) {
      assert.ok(
        row.example.toLowerCase().includes(row.word.toLowerCase()),
        `${row.word} 的例句里没有出现这个词：${row.example}`,
      );
    }
  });

  it("重复执行是安全的：不会产生重复单词，还是一共 40 个", async () => {
    // 这一条很重要 —— 文档里向用户承诺过「重复执行是安全的」，
    // 靠的是 insert 语句末尾的 on conflict (word) do update。
    await db.exec(readSql("supabase/seed.sql"));
    assert.equal(await countWords(), EXPECTED_WORD_COUNT);
  });

  it("重复执行不会报错（确认 on conflict 写法正确）", async () => {
    await db.exec(readSql("supabase/seed.sql"));
    await db.exec(readSql("supabase/seed.sql"));
    assert.equal(await countWords(), EXPECTED_WORD_COUNT);
  });
});
