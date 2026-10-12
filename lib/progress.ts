/**
 * 学习进度的数据库读写。
 *
 * 这个文件是「页面」和「数据库」之间的那层。页面只管调函数拿数据，
 * 不关心 SQL 长什么样；想改查询也只改这里。
 *
 * 【贯穿本文件的两条安全原则】
 *
 * 1. 用户身份只从「服务器端会话」里取，绝不接受前端传进来的 user_id。
 *    页面上传什么参数都可以被伪造，但 cookie 里的登录凭证是 Supabase
 *    Auth 签发并验证过的，改不了。所以下面每个写操作都自己问一次
 *    「现在登录的是谁」，而不是相信调用方。
 *
 * 2. 就算第 1 条哪天写错了，数据库的行级安全策略（RLS）还会再拦一次。
 *    这就是「纵深防御」——不把安全押在单一一处。
 *
 * 另外注意：这里没有任何 `as` 强制类型转换。因为 types/database.ts 已经把
 * 表结构告诉了 TypeScript，所以下面每个查询的返回结果都是自动推断出来的，
 * 列名写错会直接编译不过。
 */
import {
  createInitialProgress,
  scheduleNextReview,
  type ReviewInput,
} from "@/lib/spaced-repetition";
import {
  buildDailyPlan,
  DEFAULT_TIME_ZONE,
  summarizeProgress,
  type ProgressStats,
} from "@/lib/stats";
import { createClient } from "@/lib/supabase/server";
import type { ReviewRating, Word } from "@/types";

/** createClient() 是异步的，这里取出它返回的客户端类型，避免到处写 any */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 一次最多排多少个待复习词（防止一轮太长，让人望而生畏） */
const REVIEW_QUEUE_LIMIT = 100;

/** 计算连续学习天数时往前看多少天（连续天数超过这个数就只显示到这个数） */
const STREAK_WINDOW_DAYS = 180;

/** 学习队列里的一项：一个单词 + 我当前的进度 */
export type StudyQueueEntry = {
  word: Word;
  progress: ReviewInput;
};

/**
 * 取得「当前登录用户」的 ID。
 *
 * 注意这里用的是 getUser() 而不是读 cookie 内容：
 * getUser() 会把令牌发给 Supabase Auth 服务器验证一次，
 * 返回的身份才可信。
 */
async function requireCurrentUserId(
  supabase: SupabaseServerClient,
): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error !== null || data.user === null) {
    throw new Error("登录状态已失效，请重新登录。");
  }
  return data.user.id;
}

/**
 * 取今天该复习的词（next_review_time 已经到点的）。
 * 按「最该复习的排前面」排序，所以最早到期的先出现。
 */
export async function getDueEntries(
  userId: string,
  limit: number = REVIEW_QUEUE_LIMIT,
): Promise<StudyQueueEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_word_progress")
    // 一次查询把进度和单词一起取回来：words(*) 是 PostgREST 的关联语法，
    // 它会根据外键自动把对应的单词行嵌进来。
    // 这种写法能不能被认识，靠的就是 types/database.ts 里声明的 Relationships。
    .select("*, words(*)")
    .eq("user_id", userId)
    .lte("next_review_time", new Date().toISOString())
    .order("next_review_time", { ascending: true })
    .limit(limit);

  if (error !== null) {
    throw new Error(`读取今日复习队列失败：${error.message}`);
  }

  return (data ?? []).map((row) => ({
    word: row.words,
    progress: {
      familiarity: row.familiarity,
      consecutive_correct: row.consecutive_correct,
      review_count: row.review_count,
      correct_count: row.correct_count,
      wrong_count: row.wrong_count,
    },
  }));
}

/**
 * 取我还没学过的新词。
 *
 * 这里调用的是数据库函数 get_new_words（定义在 supabase/schema.sql）。
 * 为什么不直接在 JS 里过滤？见 schema.sql 里的详细说明 ——
 * 简单说就是「学过的词可能有几千个」，拉回 JS 再排除会撑爆请求地址。
 *
 * 注意：这个函数不需要传 userId。数据库函数内部用 auth.uid()
 * 自己判断「我是谁」，前端传什么都没用。
 */
export async function getNewEntries(limit: number): Promise<StudyQueueEntry[]> {
  if (limit <= 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_new_words", {
    p_limit: limit,
  });

  if (error !== null) {
    throw new Error(`读取新词失败：${error.message}`);
  }

  return (data ?? []).map((word: Word) => ({
    word,
    progress: createInitialProgress(),
  }));
}

/** 我还有多少个词完全没学过 */
export async function countNewWordsAvailable(userId: string): Promise<number> {
  const supabase = await createClient();

  // head: true 表示只要数量，不要具体数据，速度快很多
  const [allWords, learnedWords] = await Promise.all([
    supabase.from("words").select("id", { count: "exact", head: true }),
    supabase
      .from("user_word_progress")
      .select("word_id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const total = allWords.count ?? 0;
  const learned = learnedWords.count ?? 0;

  return Math.max(0, total - learned);
}

/**
 * 组装今天这一轮要背的队列：先复习到期的，再补上新词。
 */
export async function getStudyQueue(userId: string): Promise<{
  entries: Array<StudyQueueEntry & { isNew: boolean }>;
  reviewCount: number;
  newWordCount: number;
}> {
  const dueEntries = await getDueEntries(userId);
  const newWordsAvailable = await countNewWordsAvailable(userId);

  const plan = buildDailyPlan({
    dueCount: dueEntries.length,
    newWordsAvailable,
  });

  const newEntries = await getNewEntries(plan.newWordCount);

  return {
    // 给每一项标上「这是新词还是复习词」，界面据此显示角标。
    // 特意在这里标记，而不是让页面按排列顺序去猜 ——
    // 万一以后调整了顺序，界面上的角标也不会悄悄变错。
    entries: [
      ...dueEntries.map((entry) => ({ ...entry, isNew: false })),
      ...newEntries.map((entry) => ({ ...entry, isNew: true })),
    ],
    reviewCount: dueEntries.length,
    newWordCount: newEntries.length,
  };
}

/**
 * 保存一次作答。
 *
 * 做了四件事：
 *   1. 确认当前登录的是谁（不看前端传的参数）
 *   2. 读出这个词现在的进度
 *   3. 用复习算法算出新进度，然后写回数据库（upsert）
 *   4. 往流水表记一笔（用于统计和以后的 AI 功能）
 *
 * @returns 下次该复习的时间（ISO 字符串）
 */
export async function saveReview(
  wordId: number,
  rating: ReviewRating,
): Promise<{ nextReviewTime: string }> {
  const supabase = await createClient();
  const userId = await requireCurrentUserId(supabase);

  // ---- 1. 读当前进度 ----
  const { data: existing, error: readError } = await supabase
    .from("user_word_progress")
    .select(
      "familiarity, consecutive_correct, review_count, correct_count, wrong_count",
    )
    .eq("user_id", userId)
    .eq("word_id", wordId)
    .maybeSingle();

  if (readError !== null) {
    throw new Error(`读取学习进度失败：${readError.message}`);
  }

  const current: ReviewInput = existing ?? createInitialProgress();

  // ---- 2. 用算法算出新进度 ----
  const next = scheduleNextReview(current, rating, new Date());

  // ---- 3. 写回进度 ----
  // upsert = 有则更新、无则插入。之所以能这么写，是因为建表时加了
  // unique (user_id, word_id) 约束，数据库知道按什么判断「重复」。
  const { error: writeError } = await supabase
    .from("user_word_progress")
    .upsert(
      { user_id: userId, word_id: wordId, ...next },
      { onConflict: "user_id,word_id" },
    );

  if (writeError !== null) {
    // 这一条失败必须让用户知道，否则他会以为背过了、其实没存上
    throw new Error(`保存学习进度失败：${writeError.message}`);
  }

  // ---- 4. 记一笔流水 ----
  const { error: logError } = await supabase.from("review_logs").insert({
    user_id: userId,
    word_id: wordId,
    rating,
    familiarity_after: next.familiarity,
  });

  if (logError !== null) {
    // 【为什么这里只是打印日志，而不报错】
    // 进度已经保存成功了，背单词可以继续。流水只影响统计图表，
    // 不值得因为它失败而打断你学习 —— 更糟的是，若这里抛错，
    // 页面会显示「保存失败」然后停在原地，而实际上进度已经存进去了，
    // 你重复点只会让计数加倍。
    // 所以：主流程必须成功，附属记录失败就记在本子上。
    console.error("写入学习流水失败（不影响背单词）：", logError.message);
  }

  return { nextReviewTime: next.next_review_time };
}

/**
 * 汇总 Dashboard 需要的所有数字。
 */
export async function getStats(
  userId: string,
): Promise<ProgressStats & { newWordsAvailable: number }> {
  const supabase = await createClient();

  const since = new Date(
    Date.now() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 三个查询互不依赖，用 Promise.all 一起发出去，比一个个等快得多
  const [progressResult, logsResult, newWordsAvailable] = await Promise.all([
    supabase
      .from("user_word_progress")
      .select("word_id, familiarity, next_review_time")
      .eq("user_id", userId),

    // 只取需要的两列，且只取最近 180 天 —— 没必要把几年历史全拉回来
    supabase
      .from("review_logs")
      .select("reviewed_at, rating")
      .eq("user_id", userId)
      .gte("reviewed_at", since)
      .order("reviewed_at", { ascending: false }),

    countNewWordsAvailable(userId),
  ]);

  if (progressResult.error !== null) {
    throw new Error(`读取学习进度失败：${progressResult.error.message}`);
  }
  if (logsResult.error !== null) {
    throw new Error(`读取学习记录失败：${logsResult.error.message}`);
  }

  // 这里的参数不再需要强制类型转换：上面 select 写明了要哪几列，
  // TypeScript 已经推出返回的数据正好符合统计函数的要求。
  const stats = summarizeProgress(
    progressResult.data ?? [],
    logsResult.data ?? [],
    new Date(),
    DEFAULT_TIME_ZONE,
  );

  return { ...stats, newWordsAvailable };
}
