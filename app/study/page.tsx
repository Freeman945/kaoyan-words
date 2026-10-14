import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { StudySession, type StudyItem } from "@/components/StudySession";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getFocusWords, getStudyQueue } from "@/lib/progress";
import { submitReview } from "./actions";

export const metadata: Metadata = {
  title: "背单词 · 考研英语背单词",
};

/** 这个页面每次都要读当前用户的数据，不能预生成成静态页 */
export const dynamic = "force-dynamic";

/**
 * 背单词页面（正式版，会真正保存进度）。
 *
 * 数据流：
 *   1. requireUser() 确认已登录，拿到用户 ID
 *   2. getStudyQueue() 去 Supabase 取「今天该背的词」：
 *      先排到期该复习的，再补上设定数量的新词
 *   3. 把结果交给 StudySession 组件显示
 *   4. 你点按钮时，StudySession 调用 submitReview()（Server Action）
 *      写回数据库，写成功了才进入下一个词
 */
/**
 * 背单词页面（正式版，会真正保存进度）。
 *
 * 数据流：
 *   1. requireUser() 确认已登录，拿到用户 ID
 *   2. 去 Supabase 取「这一轮要背的词」：
 *      - 默认：先排艾宾浩斯表上到期该复习的，再补上设定数量的新词
 *      - 带 ?focus=1：改成只背「重点词」（见 /focus 页面）
 *   3. 把结果交给 StudySession 组件显示
 *   4. 你点按钮时，StudySession 调用 submitReview()（Server Action）
 *      写回数据库
 */
type StudyPageProps = {
  /** Next.js 16 里 searchParams 是 Promise，必须 await 才能拿到 */
  searchParams: Promise<{ focus?: string }>;
};

export default async function StudyPage({ searchParams }: StudyPageProps) {
  // 还没填密钥时给出明确指引，而不是跳到一个用不了的登录页
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const user = await requireUser();
  const params = await searchParams;
  // 从 /focus 页面点「马上攻克这些词」会带 ?focus=1 进来
  const focusMode = params.focus === "1";

  let items: StudyItem[] = [];
  let errorMessage: string | null = null;
  let reviewCount = 0;
  let newWordCount = 0;

  try {
    if (focusMode) {
      /*
       * 重点词模式：不管到没到期，只背最该盯的那些词。
       *
       * 为什么允许「没到期也背」：
       * 重点词的定义就是「从错误记录看它是个隐患」。等它自然到期
       * 可能还要好几天，而那几天里它只会被忘得更干净。
       */
      const focusWords = await getFocusWords(user.id, 30);
      items = focusWords.map((entry) => ({
        word: entry.word as StudyItem["word"],
        progress: {
          familiarity: entry.progress.familiarity,
          consecutive_correct: entry.progress.consecutive_correct,
          review_count: entry.progress.review_count,
          correct_count: entry.progress.correct_count,
          wrong_count: entry.progress.wrong_count,
        },
        // 重点词都是学过的，所以不是「新词」
        isNew: false,
      }));
    } else {
      const queue = await getStudyQueue(user.id);
      reviewCount = queue.reviewCount;
      newWordCount = queue.newWordCount;
      items = queue.entries.map((entry) => ({
        word: entry.word,
        progress: entry.progress,
        // 界面会据此在单词卡上显示「新词」或「复习」角标
        isNew: entry.isNew,
      }));
    }
  } catch (cause) {
    // 最常见的原因：还没在 Supabase 里执行 supabase/schema.sql
    errorMessage =
      cause instanceof Error ? cause.message : "读取学习数据失败。";
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-900"
        >
          ← 返回
        </Link>

        {items.length > 0 && (
          <span className="text-xs tabular-nums text-zinc-400">
            {focusMode
              ? `重点词 ${items.length}`
              : `复习 ${reviewCount} · 新词 ${newWordCount}`}
          </span>
        )}
      </div>

      {errorMessage !== null ? (
        <div className="border-l-2 border-rose-400 bg-rose-50/60 py-3 pl-4 text-sm">
          <p className="font-medium text-rose-900">读取学习数据失败</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800">
            {errorMessage}
          </pre>
          <p className="mt-2 text-xs text-rose-800">
            若提示表不存在：在 Supabase 的 SQL Editor 里依次执行{" "}
            <code className="rounded bg-white/70 px-1">supabase/schema.sql</code>{" "}
            和 <code className="rounded bg-white/70 px-1">supabase/seed.sql</code>
            。
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-16 text-center text-sm text-zinc-500">
          今日已完成
        </div>
      ) : (
        /* 直接把这个 Server Action 当参数传进去。
           服务端组件不能传普通函数给客户端组件，但 Server Action 可以。 */
        <StudySession items={items} onRate={submitReview} />
      )}
    </main>
  );
}
