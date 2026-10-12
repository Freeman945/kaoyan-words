/**
 * 数据库结构与安全策略的自动测试。
 *
 * 【为什么这个测试特别有价值】
 * 你把最重要的要求定成了「用户 A 的学习记录只能属于用户 A，用户 B 登录后
 * 不能看到 A 的进度」。这条规则是靠数据库的 RLS 策略实现的 —— 但策略写得
 * 对不对，光看 SQL 是看不出来的，必须真的跑一遍。
 *
 * 正常情况下要验证它，你得先注册 Supabase、建表、造两个账号。
 * 这里我们用 PGlite（编译成 WebAssembly 的真实 PostgreSQL）在本地起一个
 * 临时数据库，先把 supabase-shim.sql（Supabase 环境的替身）跑一遍，
 * 再把真正的 supabase/schema.sql 原封不动地执行，然后扮演 A、B、未登录
 * 三种身份去反复试探。
 *
 * 所以在你还没注册 Supabase 之前，这些策略就已经被验证过了。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

/** npm test 是从项目根目录运行的，所以这里直接用 cwd */
const projectRoot = process.cwd();

function readSql(relativePath: string): string {
  const fullPath = resolve(projectRoot, relativePath);
  try {
    return readFileSync(fullPath, "utf8");
  } catch {
    throw new Error(
      `读不到 ${relativePath}。请确认测试是在项目根目录下运行的（npm test）。`,
    );
  }
}

const SHIM_SQL = readSql("supabase/supabase-shim.sql");
const SCHEMA_SQL = readSql("supabase/schema.sql");

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

/**
 * 扮演某个角色执行一段操作。
 *
 * set role 是 PostgreSQL 的「切换身份」命令：切换之后，数据库就会按那个
 * 角色的权限和 RLS 策略来判断你能做什么。这正是 Supabase 在每次请求时
 * 做的事 —— 它不会用超级用户去查你的数据，而是切换成 authenticated 角色。
 */
async function asRole<T>(
  role: "authenticated" | "anon",
  userId: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? "",
  ]);

  try {
    return await operation();
  } finally {
    // 无论如何都要切回超级用户，否则后面的测试会在错误的身份下运行
    await db.exec("reset role;");
  }
}

/** 扮演已登录用户 */
function asUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  return asRole("authenticated", userId, operation);
}

/** 扮演未登录访客 */
function asAnon<T>(operation: () => Promise<T>): Promise<T> {
  return asRole("anon", null, operation);
}

/** 查询辅助：只关心行数时用它，省得每次都解构 */
async function rowCount(sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query(sql, params as never[]);
  return result.rows.length;
}

before(async () => {
  db = new PGlite();

  // 1. 先搭好 Supabase 环境的替身
  await db.exec(SHIM_SQL);

  // 2. 再原封不动地执行真实的 schema.sql —— 这一步同时验证了 SQL 语法正确
  await db.exec(SCHEMA_SQL);

  // 3. 造两个测试用户
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com');
  `);

  // 4. 造两个单词（用超级用户插入，相当于你在 Supabase 控制台执行 seed.sql）
  await db.exec(`
    insert into public.words (word, meaning, difficulty) values
      ('abandon',  '放弃；抛弃', 2),
      ('coherent', '连贯的；条理清楚的', 4);
  `);

  // 5. 造进度：A 学过 abandon，B 学过 coherent
  await db.exec(`
    insert into public.user_word_progress (user_id, word_id, familiarity)
      select '${USER_A}', id, 2 from public.words where word = 'abandon';
    insert into public.user_word_progress (user_id, word_id, familiarity)
      select '${USER_B}', id, 1 from public.words where word = 'coherent';
  `);
});

after(async () => {
  await db.close();
});

// ============================================================
// 一、表结构
// ============================================================
describe("表结构", () => {
  it("schema.sql 能成功执行，三张表都建好了", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    );
    const names = rows.map((row) => row.table_name);

    assert.ok(names.includes("words"), "缺少 words 表");
    assert.ok(names.includes("user_word_progress"), "缺少 user_word_progress 表");
    assert.ok(names.includes("review_logs"), "缺少 review_logs 表");
  });

  it("三张表都开启了行级安全（RLS）", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace
         and relname in ('words', 'user_word_progress', 'review_logs')`,
    );

    assert.equal(rows.length, 3, "应找到三张表");
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} 没有开启 RLS`);
    }
  });
});

// ============================================================
// 二、words 表：公共可读，但谁都不能改
// ============================================================
describe("words 表：所有人可读，谁都不能改", () => {
  it("未登录访客也能读单词（诊断页需要）", async () => {
    const count = await asAnon(() => rowCount("select word from public.words"));
    assert.equal(count, 2);
  });

  it("登录用户能读单词", async () => {
    const count = await asUser(USER_A, () =>
      rowCount("select word from public.words"),
    );
    assert.equal(count, 2);
  });

  it("未登录访客不能往单词库插数据", async () => {
    await assert.rejects(
      asAnon(() =>
        db.exec(`insert into public.words (word, meaning) values ('hack', '入侵')`),
      ),
      "anon 不应该能插入单词",
    );
  });

  it("登录用户也不能往单词库插数据", async () => {
    await assert.rejects(
      asUser(USER_A, () =>
        db.exec(`insert into public.words (word, meaning) values ('hack2', '入侵')`),
      ),
      "普通用户不应该能插入单词",
    );
  });

  it("谁都不能清空单词库（TRUNCATE 不看 RLS，所以权限单独收回了）", async () => {
    await assert.rejects(asAnon(() => db.exec("truncate public.words")));
    await assert.rejects(asUser(USER_A, () => db.exec("truncate public.words")));
  });

  it("难度被限制在 1-5 之间", async () => {
    await assert.rejects(
      db.exec(
        `insert into public.words (word, meaning, difficulty) values ('bad', '坏', 9)`,
      ),
    );
  });
});

// ============================================================
// 三、进度表：用户之间完全隔离（本项目最关键的一组测试）
// ============================================================
describe("进度表：A 和 B 的数据彻底隔离", () => {
  it("A 只看得到自己的进度，看不到 B 的", async () => {
    const { rows } = await asUser(USER_A, () =>
      db.query<{ user_id: string; word: string }>(
        `select p.user_id, w.word
         from public.user_word_progress p
         join public.words w on w.id = p.word_id`,
      ),
    );

    assert.equal(rows.length, 1, "A 只应该有 1 条进度");
    assert.equal(rows[0].user_id, USER_A);
    assert.equal(rows[0].word, "abandon");
  });

  it("B 只看得到自己的进度，看不到 A 的", async () => {
    const { rows } = await asUser(USER_B, () =>
      db.query<{ user_id: string; word: string }>(
        `select p.user_id, w.word
         from public.user_word_progress p
         join public.words w on w.id = p.word_id`,
      ),
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, USER_B);
    assert.equal(rows[0].word, "coherent");
  });

  it("A 就算显式去查 B 的 user_id，也只会拿到 0 行", async () => {
    const count = await asUser(USER_A, () =>
      rowCount("select * from public.user_word_progress where user_id = $1", [
        USER_B,
      ]),
    );
    assert.equal(count, 0, "RLS 必须在数据库层挡住这种查询");
  });

  it("未登录访客连进度表都没有访问权限", async () => {
    await assert.rejects(
      asAnon(() => db.query("select * from public.user_word_progress")),
      "anon 不应该能查询进度表",
    );
  });

  it("A 不能把进度写到 B 名下（with check 拦截）", async () => {
    await assert.rejects(
      asUser(USER_A, () =>
        db.exec(`
          insert into public.user_word_progress (user_id, word_id)
          select '${USER_B}', id from public.words where word = 'coherent'
        `),
      ),
      "插入时时把 user_id 写成别人，必须被拒绝",
    );
  });

  it("A 改不动 B 的进度（受影响行数为 0）", async () => {
    const result = await asUser(USER_A, () =>
      db.query(
        "update public.user_word_progress set familiarity = 3 where user_id = $1",
        [USER_B],
      ),
    );
    assert.equal(result.affectedRows, 0);
  });

  it("A 删不掉 B 的进度（受影响行数为 0）", async () => {
    const result = await asUser(USER_A, () =>
      db.query("delete from public.user_word_progress where user_id = $1", [USER_B]),
    );
    assert.equal(result.affectedRows, 0);
  });

  it("确认 B 的数据确实还在（上两个测试是真的没删掉，不是假象）", async () => {
    const count = await rowCount(
      "select * from public.user_word_progress where user_id = $1",
      [USER_B],
    );
    assert.equal(count, 1, "B 的进度必须完好无损");
  });
});

// ============================================================
// 四、数据完整性约束
// ============================================================
describe("数据完整性约束", () => {
  it("同一个用户对同一个单词不能有两条进度（这是 upsert 能用的前提）", async () => {
    await assert.rejects(
      db.exec(`
        insert into public.user_word_progress (user_id, word_id)
        select '${USER_A}', id from public.words where word = 'abandon'
      `),
      "唯一约束应该阻止重复记录",
    );
  });

  it("掌握程度只能是 0-3", async () => {
    await assert.rejects(
      db.exec(`
        insert into public.user_word_progress (user_id, word_id, familiarity)
        select '${USER_A}', id, 7 from public.words where word = 'coherent'
      `),
    );
  });

  it("upsert 能正确更新已有记录，而不会报错", async () => {
    await db.exec(`
      insert into public.user_word_progress (user_id, word_id, familiarity, review_count)
      select '${USER_A}', id, 3, 5 from public.words where word = 'abandon'
      on conflict (user_id, word_id) do update set
        familiarity  = excluded.familiarity,
        review_count = excluded.review_count
    `);

    const { rows } = await db.query<{ familiarity: number; review_count: number }>(
      `select familiarity, review_count from public.user_word_progress where user_id = $1`,
      [USER_A],
    );
    assert.equal(rows.length, 1, "upsert 不应该产生第二行");
    assert.equal(rows[0].familiarity, 3);
    assert.equal(rows[0].review_count, 5);
  });

  it("updated_at 会在记录被修改时自动更新（触发器生效）", async () => {
    const before = await db.query<{ updated_at: Date }>(
      "select updated_at from public.user_word_progress where user_id = $1",
      [USER_A],
    );

    await db.exec(
      `update public.user_word_progress set familiarity = 2 where user_id = '${USER_A}'`,
    );

    const later = await db.query<{ updated_at: Date }>(
      "select updated_at from public.user_word_progress where user_id = $1",
      [USER_A],
    );

    assert.ok(
      new Date(later.rows[0].updated_at).getTime() >=
        new Date(before.rows[0].updated_at).getTime(),
      "updated_at 应该被触发器刷新",
    );
  });
});

// ============================================================
// 五、流水表（review_logs）
// ============================================================
describe("流水表：能记账，但不能改账", () => {
  it("A 能插入自己的作答记录", async () => {
    await asUser(USER_A, () =>
      db.exec(`
        insert into public.review_logs (user_id, word_id, rating, familiarity_after)
        select '${USER_A}', id, 'good', 2 from public.words where word = 'abandon'
      `),
    );

    const count = await asUser(USER_A, () =>
      rowCount("select * from public.review_logs"),
    );
    assert.equal(count, 1);
  });

  it("A 看不到 B 的流水记录", async () => {
    // 用超级用户给 B 造一条（模拟 B 自己作答）
    await db.exec(`
      insert into public.review_logs (user_id, word_id, rating, familiarity_after)
      select '${USER_B}', id, 'again', 0 from public.words where word = 'coherent'
    `);

    const { rows } = await asUser(USER_A, () =>
      db.query<{ user_id: string }>("select * from public.review_logs"),
    );

    assert.equal(rows.length, 1, "A 只应看到自己那 1 条");
    assert.equal(rows[0].user_id, USER_A);
  });

  it("A 不能把流水记到 B 名下", async () => {
    await assert.rejects(
      asUser(USER_A, () =>
        db.exec(`
          insert into public.review_logs (user_id, word_id, rating, familiarity_after)
          select '${USER_B}', id, 'good', 2 from public.words where word = 'abandon'
        `),
      ),
    );
  });

  it("流水记录改不了（故意不给 update 策略）", async () => {
    const result = await asUser(USER_A, () =>
      db.query("update public.review_logs set rating = 'hard'"),
    );
    assert.equal(result.affectedRows, 0);
  });

  it("流水记录删不掉（故意不给 delete 策略）", async () => {
    const result = await asUser(USER_A, () =>
      db.query("delete from public.review_logs"),
    );
    assert.equal(result.affectedRows, 0);
  });

  it("rating 只能是 again / hard / good 三种之一", async () => {
    await assert.rejects(
      db.exec(`
        insert into public.review_logs (user_id, word_id, rating, familiarity_after)
        select '${USER_A}', id, '随便写的', 2 from public.words where word = 'abandon'
      `),
    );
  });

  it("未登录访客无权访问流水表", async () => {
    await assert.rejects(() => asAnon(() => db.query("select * from public.review_logs")));
  });
});
