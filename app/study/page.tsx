import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { StudySession, type StudyItem } from "@/components/StudySession";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getStudyQueue } from "@/lib/progress";
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
export default async function StudyPage() {
  // 还没填密钥时给出明确指引，而不是跳到一个用不了的登录页
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const user = await requireUser();

  let items: StudyItem[] = [];
  let errorMessage: string | null = null;
  let reviewCount = 0;
  let newWordCount = 0;

  try {
    const queue = await getStudyQueue(user.id);
    reviewCount = queue.reviewCount;
    newWordCount = queue.newWordCount;
    items = queue.entries.map((entry) => ({
      word: entry.word,
      progress: entry.progress,
    }));
  } catch (cause) {
    // 最常见的原因：还没在 Supabase 里执行 supabase/schema.sql
    errorMessage =
      cause instanceof Error ? cause.message : "读取学习数据失败。";
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">背单词</h1>
        <Link
          href="/"
          className="text-sm text-slate-500 underline underline-offset-2"
        >
          返回首页
        </Link>
      </div>

      {errorMessage !== null ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-medium">读取学习数据失败</p>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {errorMessage}
          </pre>
          <p className="mt-3">
            如果是提示表不存在，说明还没有执行建表语句 —— 请去 Supabase 控制台
            的 SQL Editor 里运行{" "}
            <code className="rounded bg-white/70 px-1">supabase/schema.sql</code>
            ，然后运行{" "}
            <code className="rounded bg-white/70 px-1">supabase/seed.sql</code>
            。也可以先看{" "}
            <Link href="/diagnostics" className="underline">
              连接诊断
            </Link>
            。
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-medium text-slate-900">
            今天没有需要背的单词 🎉
          </p>
          <p className="mt-2 text-sm text-slate-600">
            所有到期的词都复习完了，新词也学满了今天的量。明天再来吧。
          </p>
          <p className="mt-4 text-sm">
            <Link href="/" className="underline underline-offset-2">
              返回首页看统计
            </Link>
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            今天这一轮：复习{" "}
            <span className="font-semibold text-slate-900">{reviewCount}</span>{" "}
            个旧词 + 学习{" "}
            <span className="font-semibold text-slate-900">{newWordCount}</span>{" "}
            个新词
          </p>

          {/* 直接把这个 Server Action 当参数传进去。
              服务端组件不能传普通函数给客户端组件，但 Server Action 可以。 */}
          <StudySession items={items} onRate={submitReview} />
        </>
      )}
    </main>
  );
}
