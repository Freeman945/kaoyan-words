import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getFocusWords } from "@/lib/progress";
import { FOCUS_SCORE_THRESHOLD } from "@/lib/focus";
import { FAMILIARITY_LABELS, type Familiarity } from "@/types";

export const metadata: Metadata = {
  title: "重点词 · 考研英语背单词",
};

export const dynamic = "force-dynamic";

/** 掌握程度对应的颜色（越不熟越刺眼，方便一眼扫出问题） */
const FAMILIARITY_STYLE: Record<Familiarity, string> = {
  0: "bg-rose-100 text-rose-800",
  1: "bg-amber-100 text-amber-800",
  2: "bg-slate-100 text-slate-600",
  3: "bg-emerald-100 text-emerald-800",
};

export default async function FocusPage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const user = await requireUser();

  let focusWords: Awaited<ReturnType<typeof getFocusWords>> = [];
  let errorMessage: string | null = null;

  try {
    focusWords = await getFocusWords(user.id, 30);
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : "读取重点词失败。";
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">重点词</h1>
        <Link
          href="/"
          className="text-sm text-slate-500 underline underline-offset-2"
        >
          返回首页
        </Link>
      </div>

      {/*
        为什么要单独解释一段：
        用户看到一列词，得先明白「重点词」和「今日待复习」不是一回事，
        否则会困惑「这些词我明明今天不用复习啊」。
      */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
        <p>
          这里列的不是「今天到期该复习的词」，而是
          <strong className="text-slate-900">从你的错误记录看最容易忘的词</strong>
          —— 答错多的、一直模糊的、拖了很久没复习的。
        </p>
        <p className="mt-2">
          每个词下面都写了它<strong className="text-slate-900">为什么被挑中</strong>，
          你可以自己判断该不该多花点时间。
        </p>
      </div>

      {errorMessage !== null ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-medium">读取重点词失败</p>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {errorMessage}
          </pre>
        </div>
      ) : focusWords.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-medium text-slate-900">
            暂时没有重点词 🎉
          </p>
          <p className="mt-2 text-sm text-slate-600">
            说明你学过的词里，还没有出现「反复错」或「一直模糊」的。
            继续按今日任务背就行。
          </p>
          <p className="mt-4 text-sm">
            <Link href="/study" className="underline underline-offset-2">
              去背单词 →
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              共 <strong className="text-slate-900">{focusWords.length}</strong>{" "}
              个词需要重点关注
            </p>
            <Link
              href="/study?focus=1"
              className={
                "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white " +
                "transition hover:bg-slate-700"
              }
            >
              马上攻克这些词
            </Link>
          </div>

          <ul className="space-y-3">
            {focusWords.map((item) => (
              <li
                key={item.word.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold text-slate-900">
                    {item.word.word}
                  </span>
                  {item.word.phonetic !== null &&
                    item.word.phonetic !== "" && (
                      <span className="font-mono text-xs text-slate-500">
                        {item.word.phonetic}
                      </span>
                    )}
                  {item.word.part_of_speech !== null &&
                    item.word.part_of_speech !== "" && (
                      <span className="text-xs text-slate-400">
                        {item.word.part_of_speech}
                      </span>
                    )}
                  <span
                    className={
                      "ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium " +
                      FAMILIARITY_STYLE[item.progress.familiarity]
                    }
                  >
                    {FAMILIARITY_LABELS[item.progress.familiarity]}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-800">
                  {item.word.meaning}
                </p>

                {/* 为什么它被挑中 —— 这是这个页面最有价值的信息 */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                    >
                      {reason}
                    </span>
                  ))}
                </div>

                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                  <div className="flex gap-1">
                    <dt>复习</dt>
                    <dd className="text-slate-600">
                      {item.progress.review_count} 次
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>答对</dt>
                    <dd className="text-slate-600">
                      {item.progress.correct_count} 次
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>答错</dt>
                    <dd className="text-slate-600">
                      {item.progress.wrong_count} 次
                    </dd>
                  </div>
                  {item.overdueDays > 0 && (
                    <div className="flex gap-1">
                      <dt>逾期</dt>
                      <dd className="text-rose-600">{item.overdueDays} 天</dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>

          <p className="text-center text-xs text-slate-400">
            排序依据：掌握程度、错误率、累计答错次数、逾期天数（综合评分 ≥{" "}
            {FOCUS_SCORE_THRESHOLD} 才会出现在这里）
          </p>
        </>
      )}
    </main>
  );
}
