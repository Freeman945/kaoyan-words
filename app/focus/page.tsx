import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { StarRating } from "@/components/StarRating";
import { EXPORT_RANGE_OPTIONS } from "@/lib/attention-export";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getFocusWords } from "@/lib/progress";
import { calculateStars } from "@/lib/spaced-repetition";

export const metadata: Metadata = {
  title: "重点词",
};

export const dynamic = "force-dynamic";

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
    <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-900"
        >
          ← 返回
        </Link>
        {focusWords.length > 0 && (
          <span className="text-xs tabular-nums text-zinc-400">
            {focusWords.length} 个
          </span>
        )}
      </header>

      {/*
        导出「需要重点关注的单词」。

        每个项目都是一个直接下载链接（GET 接口），点一下就把那个时间范围的
        CSV 存下来 —— 手机弹下载，电脑直接落到下载文件夹。
        没有表单、没有二次确认：这是只读操作，不会改动任何数据。

        下面那行小字是判定标准。它必须留着 ——
        不然导出来的清单看起来会像随机挑的。
      */}
      <div className="mt-8 border-t border-zinc-200 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">导出重点词</span>
          {EXPORT_RANGE_OPTIONS.map((option) => (
            <a
              key={option.days}
              href={`/api/export/attention?days=${option.days}`}
              className={
                "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 " +
                "transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              }
            >
              {option.days} 天
            </a>
          ))}
        </div>

        <p className="mt-2 text-xs text-zinc-400">
          判定：连续 3 次没答好，或 5 次低于 4 星
        </p>
      </div>

      {errorMessage !== null ? (
        <div className="mt-8 border-l-2 border-rose-400 bg-rose-50/60 py-3 pl-4 text-sm">
          <p className="font-medium text-rose-900">读取失败</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800">
            {errorMessage}
          </pre>
        </div>
      ) : focusWords.length === 0 ? (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white px-6 py-16 text-center text-sm text-zinc-500">
          暂无重点词
        </div>
      ) : (
        <>
          <Link
            href="/study?focus=1"
            className={
              "mt-8 inline-flex h-10 items-center rounded-lg bg-zinc-900 px-5 text-sm " +
              "font-medium text-white transition-colors hover:bg-zinc-700"
            }
          >
            复习这 {focusWords.length} 个词
          </Link>

          {/*
            列表而非卡片。
            「为什么被挑中」直接写成一行小字，不再做成一个个彩色标签 ——
            标签多了会变成装饰，文字反而更好读。
          */}
          <ul className="mt-6 divide-y divide-zinc-200 border-t border-zinc-200">
            {focusWords.map((item) => (
              <li key={item.word.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-zinc-900">
                      {item.word.word}
                    </span>
                    {item.word.phonetic !== null &&
                      item.word.phonetic !== "" && (
                        <span className="font-mono text-xs text-zinc-400">
                          {item.word.phonetic}
                        </span>
                      )}
                  </div>

                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    {item.word.meaning}
                  </p>

                  <p className="mt-1 text-xs text-zinc-400">
                    {item.reasons.join(" · ")}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <StarRating
                    stars={calculateStars(
                      item.progress.correct_count,
                      item.progress.wrong_count,
                    )}
                  />
                  <p className="mt-1 text-xs tabular-nums text-zinc-400">
                    错 {item.progress.wrong_count} / {item.progress.review_count}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
