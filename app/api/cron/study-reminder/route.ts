/**
 * 晚间学习提醒的接口，由 Vercel 定时任务调用。
 *
 * 工作流程（对每个用户）：
 *   1. 今天已经发过提醒了吗？  → 是就跳过
 *   2. 今天有作答记录吗？      → 有就跳过（只要开始背了就不打扰）
 *   3. 到 22 点了吗？          → 没到就跳过
 *   4. 三条都通过 → 先往 study_reminder_log 占位，再发邮件
 *      发失败就把占位撤掉，否则这一天就再也补发不了了
 *
 * 【为什么要有 CRON_SECRET】
 * 这个接口一旦公开，任何人都能反复调它 —— 结果就是往你邮箱里灌垃圾。
 * Vercel 的定时任务会自动带上 `Authorization: Bearer $CRON_SECRET`，
 * 所以只要配了这个环境变量，别人就调不动。
 *
 * 【为什么这个文件能读所有人的数据】
 * 它用的是 secret key（见 lib/supabase/admin.ts），会绕过 RLS。
 * 这是本项目唯一一处绕过安全策略的地方，所以限制得很死：
 * 只在带对了密钥的定时任务请求里才执行。
 */
import { NextResponse } from "next/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { getStats } from "@/lib/progress";
import { buildDailyPlan, DEFAULT_TIME_ZONE, localDateKey } from "@/lib/stats";
import {
  buildStudyReminderEmail,
  shouldSendStudyReminder,
} from "@/lib/study-reminder";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// 每次调用都要现算，不能被缓存
export const dynamic = "force-dynamic";

/** 邮件里那个链接指向哪。想改就设 NEXT_PUBLIC_SITE_URL。 */
const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kaoyan-words.vercel.app";

/** 北京时间的时区偏移，用于把「今天」换算成一个具体时刻 */
const TIME_ZONE_OFFSET = "+08:00";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret === undefined || cronSecret === "") {
    return NextResponse.json(
      {
        error:
          "没有配置 CRON_SECRET。为避免任何人都能触发这个接口（往你邮箱里灌邮件），拒绝执行。",
      },
      { status: 500 },
    );
  }

  // Vercel 定时任务会自动带上这一行
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "没有配置 SUPABASE_SECRET_KEY，读不到数据。" },
      { status: 500 },
    );
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "没有配置 RESEND_API_KEY，发不出邮件。" },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const now = new Date();
  const today = localDateKey(now, DEFAULT_TIME_ZONE);
  const todayStart = `${today}T00:00:00${TIME_ZONE_OFFSET}`;

  /*
   * 测试模式：带上 ?force=1 就跳过「到点了吗 / 今天学了吗 / 今天发过了吗」
   * 三个判断，直接发一封。
   *
   * 为什么需要它：真正的提醒只在晚上 10 点后发。如果配错了要等到 22 点
   * 才发现，那中间几个小时都是瞎等。测试模式让你随时能验证整条链路。
   * 它同样要求 CRON_SECRET，所以不会被别人拿来灌邮件。
   * 主题会加 [测试] 前缀，免得和真提醒混淆；也不会写发送记录。
   */
  const force = new URL(request.url).searchParams.get("force") === "1";

  const { data: userPage, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (usersError !== null) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  const outcomes: Array<{ email: string; action: string; detail?: string }> = [];

  for (const user of userPage.users) {
    const email = user.email;
    if (email === undefined || email === "") continue;

    // ① 今天发过了吗
    const { data: sentRows } = await admin
      .from("study_reminder_log")
      .select("reminder_date")
      .eq("user_id", user.id)
      .eq("reminder_date", today)
      .limit(1);

    // ② 今天作答过吗
    const { count: todayCount } = await admin
      .from("review_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("reviewed_at", todayStart);

    const shouldSend =
      force ||
      shouldSendStudyReminder({
        now,
        reviewedToday: todayCount ?? 0,
        alreadySentToday: (sentRows?.length ?? 0) > 0,
      });

    if (!shouldSend) {
      outcomes.push({ email, action: "skip" });
      continue;
    }

    // 复用界面那套统计，保证邮件里的数字和首页看到的一致。
    // 第二个参数是管理员客户端 —— 定时任务没有登录态，只能用这个。
    const stats = await getStats(user.id, admin);

    const plan = buildDailyPlan({
      dueCount: stats.dueForReview,
      newWordsAvailable: stats.newWordsAvailable,
    });

    const mail = buildStudyReminderEmail({
      dueForReview: plan.reviewCount,
      dailyNewWords: plan.newWordCount,
      streakDays: stats.streakDays,
      appUrl: APP_URL,
    });

    // ③ 先占位再发。插不进去说明已经发过了（重试、并发都挡得住）
    // 测试模式不占位 —— 否则你只能测一次，之后就被「今天已发过」挡住
    if (!force) {
      const { error: claimError } = await admin
        .from("study_reminder_log")
        .insert({ user_id: user.id, reminder_date: today });

      if (claimError !== null) {
        outcomes.push({ email, action: "already-sent" });
        continue;
      }
    }

    const result = await sendEmail({
      to: email,
      subject: force ? `[测试] ${mail.subject}` : mail.subject,
      text: mail.text,
      html: mail.html,
    });

    if (!result.ok) {
      // 发失败要撤掉占位，否则今天再也补发不了了（测试模式本来就没占位）
      if (!force) {
        await admin
          .from("study_reminder_log")
          .delete()
          .eq("user_id", user.id)
          .eq("reminder_date", today);
      }

      outcomes.push({ email, action: "failed", detail: result.error });
      continue;
    }

    outcomes.push({ email, action: force ? "sent(test)" : "sent" });
  }

  return NextResponse.json({ today, outcomes });
}
