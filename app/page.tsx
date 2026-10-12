import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { SignOutButton } from "@/components/SignOutButton";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getStats } from "@/lib/progress";
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
  let errorMessage: string | null = null;

  try {
    stats = await getStats(user.id);
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : "读取统计失败。";
  }

  // 用和背单词页面同一套函数来算今日任务，
  // 这样首页显示的「今天要背多少」和点进去看到的数量一定一致。
  const plan =
    stats === null
      ? null
      : buildDailyPlan({
          dueCount: stats.dueForReview,
          newWordsAvailable: stats.newWordsAvailable,
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

      {stats !== null && plan !== null && (
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
              hint={`还剩 ${stats.newWordsAvailable} 个没学`}
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

          <WeeklyChart days={stats.last7Days} />

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
