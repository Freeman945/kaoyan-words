/**
 * 对「真实 Supabase」做一次端到端验证。
 *
 * 【它解决什么问题】
 * 之前所有针对数据库的验证都是在本地 PGlite（WASM 版 PostgreSQL）上做的。
 * 那验证了 SQL 和安全策略的逻辑，但验证不了两件只有真实环境才有的事：
 *   1. 网络与鉴权链路 —— 真的能从外面连上你的项目吗？
 *   2. PostgREST 的写法 —— `.select("*, words(*)")` 这种关联查询语法，
 *      以及 upsert 的 onConflict，只有真的发给 Supabase 才知道对不对。
 *
 * 这个脚本用你在 .env.local 里配好的密钥，扮演两个用户去反复试探，
 * 逐条打印结果。它跑的正是 lib/progress.ts 里用的那些调用，
 * 所以通过就等于「数据层真的能用」。
 *
 * 用法：
 *   npm run verify:supabase
 *
 * 注意：会创建两个测试账号（verify-a@example.com / verify-b@example.com）
 * 并写入若干测试记录。它们只属于这两个测试账号，不影响你自己的账号。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(thisFile), "..");
const envFilePath = resolve(projectRoot, ".env.local");

/** 从 .env.local 读一个变量（只处理 KEY=VALUE 这种简单格式） */
function readEnvFileValue(name) {
  if (!existsSync(envFilePath)) return undefined;
  for (const rawLine of readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).trim() === name) {
      return line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

/*
 * 【为什么开头要重新启动自己一次】
 * 这台电脑需要走代理才能连外网，而让 Node 使用代理的开关
 * NODE_USE_ENV_PROXY 只在 Node **进程启动的那一瞬间**被读取 ——
 * 在脚本内部设置是无效的（我实测过，会报 ECONNRESET）。
 *
 * 所以：如果发现自己没带代理启动，就读一下 .env.local 里的代理地址，
 * 用正确的环境变量把自己重新拉起一次，然后退出。
 */
if (process.env.NODE_USE_ENV_PROXY !== "1") {
  const proxy = readEnvFileValue("HTTPS_PROXY");
  if (proxy) {
    console.log(`[verify] 检测到代理 ${proxy}，正在以代理模式重启…\n`);
    const exitCode = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [thisFile, ...process.argv.slice(2)], {
        env: {
          ...process.env,
          HTTPS_PROXY: proxy,
          HTTP_PROXY: proxy,
          NODE_USE_ENV_PROXY: "1",
        },
        stdio: "inherit",
      });
      child.on("exit", (code) => resolvePromise(code ?? 0));
    });
    process.exit(exitCode);
  }
}

// ---------------------------------------------------------------
// 验证逻辑
// ---------------------------------------------------------------

const TEST_PASSWORD = "verify-password-123456";

/*
 * 测试账号的邮箱，从 .env.local 读取。
 *
 * 【为什么不用 verify-a@example.com 这种】
 * Supabase 会校验邮箱域名，example.com 是 IANA 保留域名，会被直接拒绝
 * （实测报错：Email address "..." is invalid）。
 * 所以改成「你自己的邮箱 + 后缀」的写法：格式一定合法，
 * 而且万一真发了邮件，也是进你自己的信箱。
 */
const USER_A_EMAIL =
  process.env.VERIFY_USER_A_EMAIL ?? readEnvFileValue("VERIFY_USER_A_EMAIL");
const USER_B_EMAIL =
  process.env.VERIFY_USER_B_EMAIL ?? readEnvFileValue("VERIFY_USER_B_EMAIL");

let passed = 0;
let failed = 0;
const skipped = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}${detail ? `  →  ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`❌ ${name}${detail ? `  →  ${detail}` : ""}`);
  }
}

function skip(name, reason) {
  skipped.push({ name, reason });
  console.log(`⏭️  ${name}  →  跳过：${reason}`);
}

/**
 * 判断一次「修改」或「删除」是不是真的被挡住了。
 *
 * 【为什么要单独写这个】
 * 数据库有两种不同的挡法，两种都算"挡住了"，但返回的形状不一样：
 *   1. 权限层面直接拒绝 —— 返回 error（例如 42501 permission denied）
 *   2. 行级安全策略把这些行过滤成"不可见" —— 没有 error，
 *      但受影响行数是 0。这种情况下 supabase-js 给的 data 可能是
 *      空数组 []，也可能是 null —— 只判断其中一种就会误报失败。
 *      （我第一版就踩了这个坑，把成功的案例报成了 ❌。）
 */
function wasBlocked(result) {
  if (result.error !== null && result.error !== undefined) {
    return { blocked: true, how: `被拒绝（${result.error.code ?? result.error.message}）` };
  }
  const affected = result.data?.length ?? 0;
  return { blocked: affected === 0, how: `影响 ${affected} 行` };
}

/** 让一个客户端以指定测试账号登录（没有就注册） */
async function signInOrSignUp(client, email) {
  // 先试登录（如果账号之前已经建好了，这一步就够了，不会再发邮件）
  const signIn = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (!signIn.error && signIn.data.session) {
    return { ok: true, how: "登录已有账号" };
  }
  const signInError = signIn.error?.message ?? "(没报错但也没有会话)";

  // 再试注册
  const signUp = await client.auth.signUp({ email, password: TEST_PASSWORD });

  if (signUp.error) {
    const isRateLimit = /rate limit/i.test(signUp.error.message);
    return {
      ok: false,
      reason:
        `登录失败（${signInError}）；注册也失败（${signUp.error.message}）` +
        (isRateLimit
          ? "\n     ⮕ 这是 Supabase 免费版自带的邮件发送限制。根因是「Confirm email」还开着：" +
            "每注册一次就尝试发一封验证邮件。\n" +
            "     去 Authentication → Sign In / Providers → Email → 关闭 Confirm email → Save"
          : ""),
    };
  }

  if (!signUp.data.session) {
    return {
      ok: false,
      reason:
        `注册成功但没有返回会话，说明项目仍然开着「邮箱验证」。\n` +
        `     去 Authentication → Sign In / Providers → Email → 关闭 Confirm email → Save\n` +
        `     （关掉之后不会再发邮件，也就不会撞上发送频率限制）`,
    };
  }

  return { ok: true, how: "新注册" };
}

async function main() {
  const url =
    readEnvFileValue("NEXT_PUBLIC_SUPABASE_URL") ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    readEnvFileValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error("❌ .env.local 里缺少 NEXT_PUBLIC_SUPABASE_URL 或密钥。");
    process.exit(1);
  }

  console.log(`项目：${url}\n`);

  // ============ 一、匿名访客（未登录）能看到什么 ============
  console.log("── 一、未登录访客 ──");

  const anon = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const wordsResult = await anon
    .from("words")
    .select("id, word, difficulty")
    .order("id")
    .limit(3);

  check(
    "未登录也能读单词库（单词是公共知识）",
    wordsResult.error === null,
    wordsResult.error?.message,
  );

  const wordCountResult = await anon
    .from("words")
    .select("id", { count: "exact", head: true });

  const wordCount = wordCountResult.count ?? 0;
  const hasWords = wordCount > 0;
  check(
    `单词库里有数据（当前 ${wordCount} 个）`,
    hasWords,
    hasWords ? "" : "请先在 Supabase 的 SQL Editor 里执行 supabase/seed.sql",
  );

  const anonProgress = await anon.from("user_word_progress").select("id").limit(1);
  check(
    "未登录访客读不到任何人的学习进度",
    anonProgress.error !== null,
    anonProgress.error?.code,
  );

  const anonLogs = await anon.from("review_logs").select("id").limit(1);
  check(
    "未登录访客读不到任何人的作答流水",
    anonLogs.error !== null,
    anonLogs.error?.code,
  );

  // ============ 二、两个测试账号登录 ============
  console.log("\n── 二、登录 ──");

  const clientA = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const clientB = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loginA = await signInOrSignUp(clientA, USER_A_EMAIL);
  check("测试账号 A 登录成功", loginA.ok, loginA.reason);
  const loginB = await signInOrSignUp(clientB, USER_B_EMAIL);
  check("测试账号 B 登录成功", loginB.ok, loginB.reason);

  if (!loginA.ok || !loginB.ok) {
    console.log("\n登录没成功，后面的检查无法进行。");
    reportAndExit();
    return;
  }

  const userA = (await clientA.auth.getUser()).data.user;
  const userB = (await clientB.auth.getUser()).data.user;
  check("两个账号确实是不同的人", userA.id !== userB.id);

  if (!hasWords) {
    console.log("\n── 三、进度隔离（需要单词数据）──");
    skip("全部进度隔离检查", "单词库是空的，插入进度会被外键约束拒绝");
    console.log("\n── 四、作答流水（需要单词数据）──");
    skip("全部流水检查", "单词库是空的");
    reportAndExit();
    return;
  }

  const wordIds = (wordsResult.data ?? []).map((row) => row.id);
  const wordIdA = wordIds[0];
  const wordIdB = wordIds[1] ?? wordIds[0];

  // ============ 三、进度表：用户隔离（本脚本的重点） ============
  console.log("\n── 三、进度表：A 和 B 是否彻底隔离 ──");

  // A 写入自己的进度（用的是 lib/progress.ts 里同样的 upsert 写法）
  const insertA = await clientA.from("user_word_progress").upsert(
    {
      user_id: userA.id,
      word_id: wordIdA,
      familiarity: 2,
      consecutive_correct: 1,
      review_count: 1,
      correct_count: 1,
      wrong_count: 0,
      last_review_time: new Date().toISOString(),
      next_review_time: new Date(Date.now() + 3 * 86400000).toISOString(),
    },
    { onConflict: "user_id,word_id" },
  );
  check("A 能保存自己的学习进度", insertA.error === null, insertA.error?.message);

  // B 也写一条
  const insertB = await clientB.from("user_word_progress").upsert(
    { user_id: userB.id, word_id: wordIdB, familiarity: 1 },
    { onConflict: "user_id,word_id" },
  );
  check("B 能保存自己的学习进度", insertB.error === null, insertB.error?.message);

  // 再写一次同一条 —— 验证 unique 约束 + onConflict 真的生效（upsert 的核心）
  const upsertAgain = await clientA.from("user_word_progress").upsert(
    { user_id: userA.id, word_id: wordIdA, familiarity: 3, review_count: 9 },
    { onConflict: "user_id,word_id" },
  );
  check("重复保存是更新而不是新增（upsert 生效）", upsertAgain.error === null, upsertAgain.error?.message);

  const aRows = await clientA
    .from("user_word_progress")
    .select("word_id, familiarity, review_count");
  check(
    "A 只看到自己那 1 条进度",
    aRows.data?.length === 1,
    `实际 ${aRows.data?.length ?? 0} 条`,
  );
  check(
    "重复保存后确实被更新了（review_count 变成 9）",
    aRows.data?.[0]?.review_count === 9,
    `review_count = ${aRows.data?.[0]?.review_count}`,
  );

  // ★ 最关键的一条：显式去查对方的 user_id
  const aPeekB = await clientA
    .from("user_word_progress")
    .select("id")
    .eq("user_id", userB.id);
  check(
    "A 显式查询 B 的 user_id 也拿不到数据",
    (aPeekB.data?.length ?? -1) === 0,
    `返回 ${aPeekB.data?.length ?? 0} 行`,
  );

  // A 想把记录写到 B 名下
  const aWriteAsB = await clientA
    .from("user_word_progress")
    .upsert({ user_id: userB.id, word_id: wordIdA, familiarity: 0 });
  check("A 不能把进度写到 B 名下", aWriteAsB.error !== null, aWriteAsB.error?.code);

  // A 想改 B 的记录
  const aUpdateB = wasBlocked(
    await clientA
      .from("user_word_progress")
      .update({ familiarity: 3 })
      .eq("user_id", userB.id)
      .select(),
  );
  check("A 改不动 B 的进度", aUpdateB.blocked, aUpdateB.how);

  // A 想删 B 的记录
  const aDeleteB = wasBlocked(
    await clientA
      .from("user_word_progress")
      .delete()
      .eq("user_id", userB.id)
      .select(),
  );
  check("A 删不掉 B 的进度", aDeleteB.blocked, aDeleteB.how);

  // 回头确认 B 的数据真的还在、而且内容没被动过
  // （不只看"影响了 0 行"，而是真的把数据读出来核对一遍 ——
  //   否则万一那个报错来自别的原因，测试就会假通过）
  const bStillThere = await clientB
    .from("user_word_progress")
    .select("familiarity");
  check(
    "确认 B 的数据完好无损（条数）",
    (bStillThere.data?.length ?? 0) === 1,
    `B 现在有 ${bStillThere.data?.length ?? 0} 条`,
  );
  check(
    "确认 B 的掌握程度没被 A 改动过（内容）",
    bStillThere.data?.[0]?.familiarity === 1,
    `familiarity = ${bStillThere.data?.[0]?.familiarity}（应为 1）`,
  );

  // ★ 关联查询 —— 这是只有真实 PostgREST 才能验证的语法
  const joined = await clientA
    .from("user_word_progress")
    .select("*, words(*)")
    .eq("user_id", userA.id);
  check(
    '关联查询 select("*, words(*)") 能正确嵌入单词',
    joined.error === null && typeof joined.data?.[0]?.words?.word === "string",
    joined.error?.message ?? `嵌入到：${joined.data?.[0]?.words?.word}`,
  );

  // ============ 四、取新词的数据库函数 ============
  console.log("\n── 四、取新词函数（每人一份）──");

  const newWordsA = await clientA.rpc("get_new_words", { p_limit: 50 });
  check("A 能调用 get_new_words", newWordsA.error === null, newWordsA.error?.message);

  const aNewWordIds = (newWordsA.data ?? []).map((row) => row.id);
  check(
    "A 学过的词不再出现在 A 的新词里",
    !aNewWordIds.includes(wordIdA),
  );
  check(
    "B 学过的词，对 A 来说仍然是新词",
    wordIdB === wordIdA || aNewWordIds.includes(wordIdB),
    "各人的进度互不影响",
  );

  const newWordsB = await clientB.rpc("get_new_words", { p_limit: 50 });
  const bNewWordIds = (newWordsB.data ?? []).map((row) => row.id);
  check("B 学过的词不再出现在 B 的新词里", !bNewWordIds.includes(wordIdB));

  const anonRpc = await anon.rpc("get_new_words", { p_limit: 5 });
  check("未登录访客无权调用 get_new_words", anonRpc.error !== null, anonRpc.error?.code);

  // ============ 五、作答流水 ============
  console.log("\n── 五、作答流水：能记账，不能改账 ──");

  const logA = await clientA.from("review_logs").insert({
    user_id: userA.id,
    word_id: wordIdA,
    rating: "good",
    familiarity_after: 2,
  });
  check("A 能写入自己的作答流水", logA.error === null, logA.error?.message);

  const logsSeenByA = await clientA.from("review_logs").select("user_id");
  const onlyMine = (logsSeenByA.data ?? []).every((row) => row.user_id === userA.id);
  check(
    "A 只能看到自己的流水",
    onlyMine && (logsSeenByA.data?.length ?? 0) > 0,
    `看到 ${logsSeenByA.data?.length ?? 0} 条`,
  );

  const logAsB = await clientA.from("review_logs").insert({
    user_id: userB.id,
    word_id: wordIdA,
    rating: "good",
    familiarity_after: 2,
  });
  check("A 不能把流水记到 B 名下", logAsB.error !== null, logAsB.error?.code);

  const updateLog = wasBlocked(
    await clientA.from("review_logs").update({ rating: "hard" }).select(),
  );
  check("流水改不了（历史不可篡改）", updateLog.blocked, updateLog.how);

  const deleteLog = wasBlocked(
    await clientA.from("review_logs").delete().select(),
  );
  check("流水删不掉", deleteLog.blocked, deleteLog.how);

  // 同样地：不只信"操作被拒绝"，而是把流水读出来核对内容没被改过。
  // 如果前面的 update 其实生效了，这里就会看到 rating 变成 "hard"。
  const logsAfter = await clientA.from("review_logs").select("rating");
  const allStillGood =
    (logsAfter.data?.length ?? 0) > 0 &&
    (logsAfter.data ?? []).every((row) => row.rating === "good");
  check(
    "确认流水内容确实没被改过（全部仍是 good）",
    allStillGood,
    `读了 ${logsAfter.data?.length ?? 0} 条，值：${[
      ...new Set((logsAfter.data ?? []).map((row) => row.rating)),
    ].join("/")}`,
  );

  // 也确认一下没被删掉
  check(
    "确认流水确实没被删掉",
    (logsAfter.data?.length ?? 0) > 0,
    `还剩 ${logsAfter.data?.length ?? 0} 条`,
  );

  reportAndExit();
}

function reportAndExit() {
  console.log("\n" + "═".repeat(52));
  console.log(`通过 ${passed} 项，失败 ${failed} 项，跳过 ${skipped.length} 项`);
  if (skipped.length > 0) {
    console.log("\n跳过原因：");
    for (const item of skipped) console.log(`  · ${item.name}：${item.reason}`);
  }
  console.log("═".repeat(52));
  process.exit(failed > 0 ? 1 : 0);
}

await main();
