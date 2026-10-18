import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { SignOutButton } from "@/components/SignOutButton";
import { StarRating } from "@/components/StarRating";
import { TestReportButton } from "@/components/TestReportButton";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import {
  getFocusWords,
  getPace,
  getStats,
  NEW_WORD_QUEUE_LIMIT,
} from "@/lib/progress";
import { calculateStars } from "@/lib/spaced-repetition";
import { buildDailyPlan, DEFAULT_TIME_ZONE, type DailyCount, type ProgressStats } from "@/lib/stats";
import { weekdayIndex } from "@/lib/weekly-report";
import { sendWeeklyReportIfDue } from "@/lib/weekly-report-send";

/**
 * 这个页面必须每次请求都重新渲染，不能被提前生成成静态页面。
 *
 * 原因：它显示的是「你的」学习统计，每个人、每一刻都不同。
 * 如果 Next.js 在构建时把它预生成成一份 HTML 重复使用，
 * 你刷新后看到的会是旧数字。
 */
export const dynamic = "force-dynamic";

type StatsWithNewWords = ProgressStats & { newWordsAvailable: number };

/** 一个大数字 + 下面的小标签。比卡片轻，适合并排放几个 */
function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn";
}) {
  return (
    <div>
      <div
        className={
          "text-3xl font-semibold tabular-nums tracking-tight " +
          (tone === "warn" ? "text-amber-700" : "text-zinc-900")
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

/** 一行「标签 —— 数值」。靠对齐和分割线成组，不靠卡片 */
function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <span className="text-sm text-zinc-500">{label}</span>
      <span
        className={
          "text-sm tabular-nums " +
          (tone === "warn"
            ? "font-medium text-amber-700"
            : tone === "muted"
              ? "text-zinc-400"
              : "font-medium text-zinc-900")
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 最近 7 天学习量。
 *
 * 没有引入图表库 —— 这个需求用 div 的高度就能表达，
 * 为了几根柱子装一个几百 KB 的依赖不划算。
 */
function WeeklyChart({ days }: { days: DailyCount[] }) {
  const maxCount = Math.max(1, ...days.map((day) => day.count));
  const maxBarHeight = 64;
  const todayKey = days[days.length - 1]?.date;

  return (
    <div className="mt-4 flex items-end justify-between gap-1.5">
      {days.map((day) => {
        const isToday = day.date === todayKey;
        const height =
          day.count === 0
            ? 2
            : Math.max(4, Math.round((day.count / maxCount) * maxBarHeight));

        return (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-[10px] tabular-nums text-zinc-400">
              {day.count > 0 ? day.count : ""}
            </span>
            <div
              className={
                "w-full rounded-sm " + (isToday ? "bg-zinc-700" : "bg-zinc-200")
              }
              style={{ height: `${height}px` }}
              title={`${day.date}：${day.count} 次`}
            />
            <span
              className={
                "text-[10px] tabular-nums " +
                (isToday ? "text-zinc-700" : "text-zinc-400")
              }
            >
              {day.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 读取统计失败时的提示 */
function StatsError({ message }: { message: string }) {
  return (
    <div className="mt-6 border-l-2 border-rose-400 bg-rose-50/60 py-3 pl-4 text-sm">
      <p className="font-medium text-rose-900">读取数据失败</p>
      <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800">
        {message}
      </pre>
    </div>
  );
}

export default async function Home() {
  // 还没填密钥时给出明确指引，而不是跳到一个用不了的登录页
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  // 没登录的话，requireUser() 内部会直接跳转到 /login
  const user = await requireUser();

  let stats: StatsWithNewWords | null = null;
  let pace: Awaited<ReturnType<typeof getPace>> | null = null;
  let errorMessage: string | null = null;
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
   * 周报：周末打开网站时发到邮箱。
   *
   * 先做纯计算的星期判断，省掉工作日每次打开首页的一次数据库往返。
   * 整段用 try/catch 包住 —— 发周报失败绝不能连累首页打不开。
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

  /*
   * 今日要背多少：不设新词配额，可学的都给你（背到不想背就停）。
   * 和背单词页面用同一套函数、同一个上限，保证两处数字一致。
   */
  const plan =
    stats === null || pace === null
      ? null
      : buildDailyPlan({
          dueCount: stats.dueForReview,
          newWordsAvailable: stats.newWordsAvailable,
          dailyNewWordGoal: NEW_WORD_QUEUE_LIMIT,
        });

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            考研词记
          </h1>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {user.email ?? "未提供邮箱"}
          </p>
        </div>
        <SignOutButton />
      </header>

      {errorMessage !== null && <StatsError message={errorMessage} />}

      {stats !== null && pace !== null && plan !== null && (
        <div className="mt-10 space-y-10">
          {/* ── 今日：首页第一重点 ── */}
          <section>
            <h2 className="text-xs font-medium tracking-wide text-zinc-400">
              今日
            </h2>
            <div className="mt-4 flex items-end gap-10">
              <Metric label="待复习" value={plan.reviewCount} />
              <Metric label="新词" value={plan.newWordCount} />
              <Metric label="合计" value={plan.total} tone="default" />
            </div>

            <Link
              href="/study"
              className="mt-6 inline-flex h-10 items-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              {plan.total > 0 ? "开始学习" : "今日已完成"}
            </Link>
          </section>

          {/* ── 进度 ── */}
          <section className="border-t border-zinc-200 pt-6">
            <h2 className="text-xs font-medium tracking-wide text-zinc-400">
              进度
            </h2>
            <div className="mt-2 divide-y divide-zinc-100">
              <Row
                label="词汇进度"
                value={`${stats.totalWords} / ${stats.totalWords + pace.remainingWords}`}
              />
              <Row label="已掌握" value={String(stats.masteredWords)} />
              <Row label="在学" value={String(stats.learningWords)} />
              <Row label="连续学习" value={`${stats.streakDays} 天`} />
              <Row
                label="预计第一轮完成"
                value={pace.projectedFinishDate ?? "—"}
                tone={pace.projectedFinishDate === null ? "muted" : "default"}
              />
              <Row label="距 2028 考研" value={`${pace.daysUntilExam} 天`} />
              {pace.avgPerDay > 0 && !pace.onTrack && (
                <Row
                  label="考前需每日新词"
                  value={String(pace.requiredPerDay)}
                  tone="warn"
                />
              )}
            </div>
          </section>

          {/* ── 最近 7 天 ── */}
          <section className="border-t border-zinc-200 pt-6">
            <h2 className="text-xs font-medium tracking-wide text-zinc-400">
              最近 7 天
            </h2>
            <WeeklyChart days={stats.last7Days} />
          </section>

          {/*
            打印重点单词表。
            刻意**不放在「重点词」那一段里** ——
            那一段是 `focusWords.length > 0` 才渲染的，
            没有重点词时整段消失，手机用户就找不到入口了。
          */}
          <section className="border-t border-zinc-200 pt-6">
            <Link
              href="/print/attention?days=7"
              className={
                "flex items-center justify-between rounded-lg border border-zinc-300 px-4 py-3 " +
                "text-sm text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              }
            >
              <span>打印重点单词表</span>
              <span className="text-zinc-400">→</span>
            </Link>
          </section>

          {/* ── 重点词 ── */}
          {focusWords.length > 0 && (
            <section className="border-t border-zinc-200 pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-xs font-medium tracking-wide text-zinc-400">
                  重点词
                </h2>
                <Link
                  href="/focus"
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-900"
                >
                  全部
                </Link>
              </div>

              <ul className="mt-2 divide-y divide-zinc-100">
                {focusWords.slice(0, 5).map((item) => (
                  <li
                    key={item.word.id}
                    className="flex items-center gap-3 py-2"
                  >
                    <span className="w-32 shrink-0 truncate font-medium text-zinc-900">
                      {item.word.word}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-500">
                      {item.word.meaning}
                    </span>
                    <StarRating
                      stars={calculateStars(
                        item.progress.correct_count,
                        item.progress.wrong_count,
                      )}
                    />
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                      错 {item.progress.wrong_count}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href="/study?focus=1"
                className="mt-4 inline-flex h-9 items-center rounded-lg border border-zinc-300 px-4 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                复习重点词
              </Link>
            </section>
          )}
        </div>
      )}

      {/*
        开发者入口。放在折叠区里，不占正常使用的视线。
      */}
      <details className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-400">
        <summary className="cursor-pointer select-none hover:text-zinc-600">
          高级
        </summary>
        <div className="mt-3 space-y-3">
          <TestReportButton />
          <div className="flex gap-4">
            <Link href="/diagnostics" className="hover:text-zinc-900">
              连接诊断
            </Link>
            <Link href="/preview/study" className="hover:text-zinc-900">
              界面预览（不写数据库）
            </Link>
          </div>
        </div>
      </details>
    </main>
  );
}
