/**
 * 一次性校验脚本：把生成的 seed-kaoyan.sql 真的在 PostgreSQL 里跑一遍。
 *
 * 为什么值得单独跑这一步：这份 SQL 有 474 KB、5490 个词，
 * 如果里面有转义漏掉的单引号，你把它粘到 Supabase 里会直接报错，
 * 而且报错信息通常指向几百行之外的某一行，很难查。
 * 在本地用 PGlite（WASM 版的真 PostgreSQL）跑一遍，
 * 几十秒就能确认它到底能不能执行。
 *
 * 跑法：npx tsx scripts/check-seed-sql.ts supabase/seed-kaoyan.sql
 *
 * 注意：这里用 main() 包起来而不是顶层 await ——
 * tsx 默认按 CommonJS 处理 .ts，顶层 await 会报错。
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main(): Promise<void> {
  const target = process.argv[2] ?? "supabase/seed-kaoyan.sql";

  const db = new PGlite();

  console.log("载入测试用的 Supabase 替身…");
  await db.exec(readFileSync("supabase/supabase-shim.sql", "utf8"));

  console.log("载入表结构…");
  await db.exec(readFileSync("supabase/schema.sql", "utf8"));

  const before = await db.query<{ n: number }>(
    "select count(*)::int as n from words",
  );
  console.log(`执行前 words 表有 ${before.rows[0].n} 个词`);

  console.log(`执行 ${target} …`);
  await db.exec(readFileSync(target, "utf8"));

  const after = await db.query<{ n: number }>(
    "select count(*)::int as n from words",
  );
  console.log(
    `执行后有 ${after.rows[0].n} 个词（新增 ${after.rows[0].n - before.rows[0].n} 个）`,
  );

  // 抽查几个词，确认音标和释义都进去了，且没有被转义问题弄坏
  const sample = await db.query<{
    word: string;
    phonetic: string | null;
    meaning: string;
  }>(
    "select word, phonetic, meaning from words where word in ('abandon','consequence','deliberate','vague','a','it') order by word",
  );

  console.log("\n抽查：");
  for (const row of sample.rows) {
    console.log(
      `  ${row.word.padEnd(14)} ${(row.phonetic ?? "").padEnd(18)} ${row.meaning}`,
    );
  }

  // 有没有音标为空、或者释义为空
  const stats = await db.query<{ no_phonetic: number; no_meaning: number }>(
    `select
       count(*) filter (where phonetic is null or phonetic = '')::int as no_phonetic,
       count(*) filter (where meaning is null or meaning = '')::int as no_meaning
     from words`,
  );
  console.log("\n健康检查：");
  console.log(`  没有音标的: ${stats.rows[0].no_phonetic}`);
  console.log(`  没有释义的: ${stats.rows[0].no_meaning}`);

  // 重复执行一次，确认「可以重复跑、不会产生重复数据」这个承诺是真的
  console.log("\n再执行一次同样的 SQL（验证可重复执行）…");
  await db.exec(readFileSync(target, "utf8"));
  const twice = await db.query<{ n: number }>(
    "select count(*)::int as n from words",
  );
  console.log(`  第二次执行后仍是 ${twice.rows[0].n} 个词`);

  if (twice.rows[0].n !== after.rows[0].n) {
    console.error("❌ 重复执行产生了重复数据！");
    process.exit(1);
  }

  console.log("\n✅ 全部通过");
}

main().catch((cause: unknown) => {
  console.error("❌ 失败：", cause);
  process.exit(1);
});
