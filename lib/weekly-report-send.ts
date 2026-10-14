/**
 * 周报的发送编排：判断该不该发 → 取数据 → 组装 → 发出去 → 记录已发。
 *
 * 【为什么是「打开网站时发送」而不是定时任务】
 * 定时任务跑起来的时候没有用户登录态。而数据库的 RLS 规则是
 * 「只能读写自己的数据」，没有登录态就什么都读不到 ——
 * 除非动用 service_role 密钥（那是能绕过所有安全策略的密钥）。
 *
 * 改成「周末你第一次打开网站时发」，就能用你自己的登录态去读数据：
 * 既安全，又不用密钥，也不用配定时任务。
 * 代价是：如果你整个周末都不打开网站，邮件会顺延到你下次打开时。
 *
 * 【怎么保证一周只发一封】
 * weekly_report_log 表上有一个唯一约束 (user_id, week_start)。
 * 发送前先插入一条记录「占位」：插得进去说明这周还没发过；
 * 插不进去（唯一冲突）说明已经发过了。这样即使你同时打开几个标签页，
 * 也不会收到好几封 —— 判断和占位是同一次数据库操作，不存在竞态。
 */
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { getFocusWords, getPace, getStats } from "@/lib/progress";
import { calculateStars } from "@/lib/spaced-repetition";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/lib/stats";
import { createClient } from "@/lib/supabase/server";
import {
  buildWeeklyReport,
  daysElapsedInWeek,
  isWeeklyReportDue,
  summarizeWeek,
  weekStartOf,
  type WeeklyReport,
} from "@/lib/weekly-report";

export type WeeklyReportOutcome =
  | { status: "not-due" }
  | { status: "already-sent" }
  | { status: "not-configured"; previewSubject: string }
  | { status: "sent"; subject: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** Postgres 的唯一约束冲突错误码 */
const UNIQUE_VIOLATION = "23505";

export async function sendWeeklyReportIfDue(params: {
  userId: string;
  email: string;
}): Promise<WeeklyReportOutcome> {
  const { userId, email } = params;
  const supabase = await createClient();
  const now = new Date();
  const timeZone = DEFAULT_TIME_ZONE;
  const weekStart = weekStartOf(now, timeZone);

  // ── 1. 上一次发的是哪一周？ ──
  const { data: lastRows, error: lastError } = await supabase
    .from("weekly_report_log")
    .select("week_start")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(1);

  if (lastError !== null) {
    // 表还没建的时候不要影响页面打开，只把原因带回去
    return {
      status: "skipped",
      reason: `读取周报记录失败（可能还没执行建表语句）：${lastError.message}`,
    };
  }

  const lastSentWeekStart = lastRows?.[0]?.week_start ?? null;

  // ── 2. 该不该发？ ──
  if (!isWeeklyReportDue(now, timeZone, lastSentWeekStart)) {
    return { status: "not-due" };
  }

  // ── 3. 把数据取齐并组装成邮件内容 ──
  const report = await composeWeeklyReport(userId, weekStart, now, timeZone);

  if (report === null) {
    return { status: "skipped", reason: "读取本周学习记录失败。" };
  }

  // ── 4. 没配密钥就别发，也别占位（配好之后还能补发这一周） ──
  if (!isEmailConfigured()) {
    return { status: "not-configured", previewSubject: report.subject };
  }

  // ── 5. 占位：插得进去才发，插不进去说明这周已经发过了 ──
  const { error: claimError } = await supabase
    .from("weekly_report_log")
    .insert({ user_id: userId, week_start: weekStart });

  if (claimError !== null) {
    if (claimError.code === UNIQUE_VIOLATION) {
      return { status: "already-sent" };
    }
    return { status: "failed", error: `占位失败：${claimError.message}` };
  }

  // ── 6. 发 ──
  const result = await sendEmail({
    to: email,
    subject: report.subject,
    text: report.text,
    html: report.html,
  });

  if (!result.ok) {
    // 发失败就把占位撤掉，否则这一周都补发不了了
    await supabase
      .from("weekly_report_log")
      .delete()
      .eq("user_id", userId)
      .eq("week_start", weekStart);

    return { status: "failed", error: result.error };
  }

  return { status: "sent", subject: report.subject };
}

/**
 * 组装周报要用到的「本周作答次数」。
 *
 * 单独一个函数是因为它需要查 review_logs，而上面的主流程里
 * 为了少一次网络往返没有 await 它 —— 这里补上。
 */
export async function loadWeekActivity(
  userId: string,
  weekStart: string,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<{ dailyReviewed: number[]; dailyNewWords: number[] } | null> {
  const supabase = await createClient();
  const since = `${weekStart}T00:00:00+08:00`;
  const weekStartDate = new Date(since);

  const [logsResult, progressResult] = await Promise.all([
    supabase
      .from("review_logs")
      .select("reviewed_at")
      .eq("user_id", userId)
      .gte("reviewed_at", since),
    supabase
      .from("user_word_progress")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since),
  ]);

  if (logsResult.error !== null || progressResult.error !== null) {
    return null;
  }

  return summarizeWeek(
    (logsResult.data ?? []).map((row) => row.reviewed_at),
    (progressResult.data ?? []).map((row) => row.created_at),
    weekStartDate,
    timeZone,
  );
}

/**
 * 把周报需要的数据取齐，并组装成邮件内容。
 *
 * 抽出来是为了让「周末自动发」和「手动测试发」共用同一套逻辑 ——
 * 否则测试时看到的内容和真正收到的不一样，那就白测了。
 */
export async function composeWeeklyReport(
  userId: string,
  weekStart: string,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<WeeklyReport | null> {
  const [stats, pace, focusWords, activity] = await Promise.all([
    getStats(userId),
    getPace(userId),
    getFocusWords(userId, 3),
    loadWeekActivity(userId, weekStart, now, timeZone),
  ]);

  if (activity === null) return null;

  // 只列到今天为止 —— 周六发的周报里不该出现一行永远为 0 的「周日」
  const elapsedDays = daysElapsedInWeek(now, timeZone);

  return buildWeeklyReport({
    weekStart,
    weekEnd: localDateKey(now, timeZone),
    dailyReviewed: activity.dailyReviewed.slice(0, elapsedDays),
    dailyNewWords: activity.dailyNewWords.slice(0, elapsedDays),
    streakDays: stats.streakDays,
    // stats.totalWords 是「有进度记录的词」，也就是已经学过的词
    learnedWords: stats.totalWords,
    // 词库总数 = 学过的 + 还没学的（pace 里算好了没学的那部分）
    totalWords: stats.totalWords + pace.remainingWords,
    masteredWords: stats.masteredWords,
    weakWords: focusWords.map((item) => ({
      word: item.word.word,
      meaning: item.word.meaning,
      wrongCount: item.progress.wrong_count,
      stars: calculateStars(
        item.progress.correct_count,
        item.progress.wrong_count,
      ),
    })),
    avgPerDay: pace.avgPerDay,
    projectedFinishDate: pace.projectedFinishDate,
    daysUntilExam: pace.daysUntilExam,
    requiredPerDay: pace.requiredPerDay,
  });
}

/**
 * 立刻发一封周报（不管是不是周末，也不占位）。
 *
 * 专门用于「测试发送」：配好邮件服务后马上能确认链路通了，不用等到周六。
 * 它**不写 weekly_report_log**，所以不会影响「一周一封」的判断 ——
 * 周末该发的那封照发不误。主题前面加了 [测试] 前缀，免得和真周报混淆。
 */
export async function sendWeeklyReportNow(params: {
  userId: string;
  email: string;
}): Promise<{ ok: true; subject: string } | { ok: false; error: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "还没有配置 RESEND_API_KEY，所以发不出去。" };
  }

  const now = new Date();
  const timeZone = DEFAULT_TIME_ZONE;
  const weekStart = weekStartOf(now, timeZone);

  const report = await composeWeeklyReport(
    params.userId,
    weekStart,
    now,
    timeZone,
  );

  if (report === null) {
    return { ok: false, error: "读取本周学习记录失败。" };
  }

  const result = await sendEmail({
    to: params.email,
    subject: `[测试] ${report.subject}`,
    text: report.text,
    html: report.html,
  });

  return result.ok ? { ok: true, subject: report.subject } : result;
}
