import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { SignOutButton } from "@/components/SignOutButton";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getFocusWords, getPace, getStats } from "@/lib/progress";
import { suggestDailyNewWordGoal } from "@/lib/pace";
import { DEFAULT_TIME_ZONE } from "@/lib/stats";
import { weekdayIndex } from "@/lib/weekly-report";
import { sendWeeklyReportIfDue } from "@/lib/weekly-report-send";
import { buildDailyPlan, type DailyCount, type ProgressStats } from "@/lib/stats";

export const metadata: Metadata = {
  title: "考研英语背单词",
};

/**
 * 这个页面必须每次请求都重新渲染，不能被提前生成成静态页面。
 *
 * 原因：它显示的是「你的」学习统计，每个人、每一刻都不同。
 * 如果 Next.js 在构建时把它预生成成一份 HTML 重复使用，
 * 你刷新后看到的会是旧数字。
 */
export const dynamic = "force-dynamic";

type StatsWithNewWords = ProgressStats & { newWordsAvailable: number };

/** 一个统计数字卡片 */
function StatCard({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (highlight
          ? "border-slate-900 bg-slate-900"
          : "border-slate-200 bg-white")
      }
    >
      <p className={"text-xs " + (highlight ? "text-slate-300" : "text-slate-500")}>
        {label}
      </p>
      <p
        className={
          "mt-1 text-2xl font-bold " +
          (highlight ? "text-white" : "text-slate-900")
        }
      >
        {value}
      </p>
      {hint !== undefined && (
        <p
          className={
            "mt-0.5 text-xs " + (highlight ? "text-slate-400" : "text-slate-400")
          }
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * 最近 7 天学习量柱状图。
 *
 * 没有引入图表库 —— 这个需求用 div 的高度就能表达，
 * 为了几根柱子装一个几百 KB 的依赖不划算。
 */
function WeeklyChart({ days }: { days: DailyCount[] }) {
  const maxCount = Math.max(1, ...days.map((day) => day.count));
  const maxBarHeight = 88;
  const todayKey = days[days.length - 1]?.date;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-900">最近 7 天学习量</p>
      <p className="mt-0.5 text-xs text-slate-500">按作答次数统计</p>

      <div className="mt-5 flex items-end justify-between gap-2">
        {days.map((day) => {
          const isToday = day.date === todayKey;
          const height =
            day.count === 0
              ? 2
              : Math.max(6, Math.round((day.count / maxCount) * maxBarHeight));

          return (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-slate-400">
                {day.count > 0 ? day.count : ""}
              </span>
              <div
                className={
                  "w-full rounded-t " + (isToday ? "bg-slate-900" : "bg-slate-300")
                }
                style={{ height: `${height}px` }}
                title={`${day.date}：${day.count} 次`}
              />
              <span
                className={
                  "text-[10px] " +
                  (isToday ? "font-medium text-slate-900" : "text-slate-400")
                }
              >
                {day.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 读取统计失败时的提示 */
function StatsError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="font-medium">读取学习统计失败</p>
      <pre className="mt-2 whitespace-pre-wrap break-words">{message}</pre>
      <p className="mt-3">
        如果提示表不存在，说明还没执行建表语句。请去 Supabase 控制台的 SQL
        Editor 依次运行{" "}
        <code className="rounded bg-white/70 px-1">supabase/schema.sql</code> 和{" "}
        <code className="rounded bg-white/70 px-1">supabase/seed.sql</code>，
        再回到{" "}
        <Link href="/diagnostics" className="underline">
          连接诊断
        </Link>
        看看。
      </p>
    </div>
  );
}

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  // 没登录的话，requireUser() 内部会直接跳转到 /login
  const user = await requireUser();

  let stats: StatsWithNewWords | null = null;
  let pace: Awaited<ReturnType<typeof getPace>> | null = null;
  let errorMessage: string | null = null;
  /*
   * 重点词：从错误记录看最该盯的那些词。
   * 这里顺便取前几个直接显示在首页 —— 「根据掌握情况给出重点词」
   * 如果还要再点一层才能看到，就没人会去看了。
   */
  let focusWords: Awaited<ReturnType<typeof getFocusWords>> = [];

  try {
    // 三个查询互不依赖，一起发出去比一个个等快得多
    [stats, pace, focusWords] = await Promise.all([
      getStats(user.id),
      getPace(user.id),
      getFocusWords(user.id, 5),
    ]);
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : "读取统计失败。";
  }

  /*
   * 周报：周末你打开网站时，把这周的情况发到你的邮箱。
   *
   * 【为什么是「打开网站时发」而不是定时任务】
   * 定时任务跑起来的时候没有用户登录态，按 RLS 规则读不到你的数据 ——
   * 除非动用 service_role 密钥。放在这里就能用你自己的登录态，
   * 既安全，也不用配定时任务。
   *
   * 【为什么先判断是不是周末】
   * 「这周发过没有」需要查一次数据库。工作日根本不会发，
   * 先做这个纯计算判断，能省掉工作日每次打开首页的一次数据库往返。
   *
   * 【为什么用 try/catch 包住】
   * 发周报失败绝不能连累首页打不开。邮件发不出去是小事，
   * 背不了单词是大事。
   */
  if (
    user.email !== undefined &&
    weekdayIndex(new Date(), DEFAULT_TIME_ZONE) >= 5
  ) {
    try {
      await sendWeeklyReportIfDue({ userId: user.id, email: user.email });
    } catch (cause) {
      console.error("[weekly-report] 发送周报时出错", cause);
    }
  }

  // 用和背单词页面同一套函数来算今日任务，
  // 这样首页显示的「今天要背多少」和点进去看到的数量一定一致。
  // 注意新词数量不再是写死的 20，而是跟着你的实际节奏算出来的。
  const plan =
    stats === null || pace === null
      ? null
      : buildDailyPlan({
          dueCount: stats.dueForReview,
          newWordsAvailable: stats.newWordsAvailable,
          dailyNewWordGoal: suggestDailyNewWordGoal(pace.avgPerDay),
        });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 sm:p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">考研英语背单词</h1>
          <p className="mt-0.5 break-all text-xs text-slate-500">
            {user.email ?? "（未提供邮箱）"}
          </p>
        </div>
        <SignOutButton />
      </header>

      {errorMessage !== null && <StatsError message={errorMessage} />}

      {stats !== null && pace !== null && plan !== null && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="今日待复习"
              value={plan.reviewCount}
              highlight={plan.reviewCount > 0}
            />
            <StatCard
              label="今日新词"
              value={plan.newWordCount}
              hint="按你的节奏安排"
            />
            <StatCard
              label="已掌握"
              value={stats.masteredWords}
              hint={`在学 ${stats.learningWords} 个`}
            />
            <StatCard label="学习总词数" value={stats.totalWords} />
          </div>

          <Link
            href="/study"
            className="block rounded-xl bg-slate-900 px-6 py-4 text-center text-base font-medium text-white transition hover:bg-slate-700"
          >
            {plan.total > 0
              ? `开始学习（${plan.total} 个词）`
              : "今天已经学完啦 · 进去看看"}
          </Link>

          {/*
            学习节奏与「什么时候能背完」。
            这一段是这次改动的重点：不再拍脑袋定「每天必须背 20 个」，
            而是观察你最近两周实际背了多少，再推算完成时间，
            并对照考研日期告诉你来不来得及。
          */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-900">
              按你最近两周的节奏估算
            </p>

            {pace.avgPerDay > 0 ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  最近 <strong className="text-slate-900">{pace.windowDays}</strong>{" "}
                  天平均每天新学{" "}
                  <strong className="text-slate-900">
                    {pace.avgPerDay.toFixed(1)}
                  </strong>{" "}
                  个词
                  {pace.activeDays < pace.windowDays && (
                    <span className="text-slate-400">
                      （{pace.windowDays} 天里有 {pace.activeDays} 天在学习，
                      休息日也算进平均里）
                    </span>
                  )}
                </p>

                <p className="mt-1.5 text-sm leading-6 text-slate-600">
                  还剩{" "}
                  <strong className="text-slate-900">{pace.remainingWords}</strong>{" "}
                  个词没学，按这个节奏预计{" "}
                  <strong className="text-slate-900">
                    {pace.projectedFinishDate}
                  </strong>{" "}
                  背完
                </p>

                <p
                  className={
                    "mt-2 text-sm font-medium " +
                    (pace.onTrack ? "text-emerald-700" : "text-rose-700")
                  }
                >
                  距离 2028 考研还有 {pace.daysUntilExam} 天 ——{" "}
                  {pace.onTrack
                    ? "这个节奏来得及 ✓"
                    : `按这个速度背不完，需要每天新学 ${pace.requiredPerDay} 个`}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  说明：新词数量不是硬性要求，是照着你的实际节奏安排的。
                  想调整节奏，多背或少背几天，估算会自动跟着变。
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                还没有足够的学习记录。先背几天，我就能根据你的实际节奏
                算出什么时候能背完、以及考试前来不来得及。
              </p>
            )}
          </div>

          <WeeklyChart days={stats.last7Days} />

          {/*
            重点词卡片。
            「今日待复习」是按艾宾浩斯时间表到期的词，而这里是
            从错误记录看出来的隐患 —— 两者不一样，所以分开显示。
            只放前几个，想全看再点进去。
          */}
          {focusWords.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-amber-900">
                  重点词 · 这些最容易忘
                </p>
                <Link
                  href="/focus"
                  className="text-xs text-amber-900 underline underline-offset-2"
                >
                  查看全部 →
                </Link>
              </div>

              <ul className="mt-3 space-y-2">
                {focusWords.slice(0, 3).map((item) => (
                  <li
                    key={item.word.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                  >
                    <span className="font-semibold text-amber-900">
                      {item.word.word}
                    </span>
                    <span className="text-amber-800">{item.word.meaning}</span>
                    <span className="text-xs text-amber-700 opacity-80">
                      {item.reasons.slice(0, 2).join("、")}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href="/study?focus=1"
                className={
                  "mt-4 block rounded-lg bg-amber-800 px-4 py-2 text-center text-sm " +
                  "font-medium text-white transition hover:bg-amber-900"
                }
              >
                马上攻克这些词
              </Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="今日已作答" value={stats.reviewedToday} hint="次" />
            <StatCard label="连续学习天数" value={stats.streakDays} hint="天" />
          </div>
        </>
      )}

      <footer className="flex items-center justify-between pt-2 text-xs text-slate-400">
        <Link href="/diagnostics" className="underline underline-offset-2">
          连接诊断
        </Link>
        <Link href="/preview/study" className="underline underline-offset-2">
          背单词界面预览（不存数据库）
        </Link>
      </footer>
    </main>
  );
}
