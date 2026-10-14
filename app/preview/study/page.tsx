import type { Metadata } from "next";
import Link from "next/link";
import { PreviewStudySession } from "@/components/PreviewStudySession";
import type { StudyItem } from "@/components/StudySession";
import { createInitialProgress } from "@/lib/spaced-repetition";
import { loadSeedWords } from "@/lib/words";

export const metadata: Metadata = {
  title: "界面预览",
};

/**
 * 必须每次请求都实时渲染。
 * 因为这个页面要读本地文件，构建时预生成没有意义。
 */
export const dynamic = "force-dynamic";

/**
 * 背单词界面预览（不连接数据库）。
 *
 * 这个页面的意义：让你在还没配置 Supabase 之前，就能看到并点击
 * 「显示释义 → 不认识/模糊/认识 → 自动下一个」的完整流程，
 * 并且亲眼看到复习算法算出来的间隔。
 *
 * 它读的是本地 data/words-seed.csv，所以不会写入任何数据。
 * 阶段 5 会做一个真正连数据库的 /study 页面，复用同样的
 * WordCard / RatingButtons / StudySession 组件。
 */
export default function PreviewStudyPage() {
  let items: StudyItem[] = [];
  let loadError: string | null = null;

  try {
    items = loadSeedWords().map((word) => ({
      word,
      // 预览时把所有单词都当成「从没学过」的新词，所以角标一律是「新词」。
      // 正式页面里，到期的旧词会显示成「复习」。
      progress: createInitialProgress(),
      isNew: true,
    }));
  } catch (cause) {
    loadError = cause instanceof Error ? cause.message : String(cause);
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
        <span className="text-xs text-zinc-400">预览 · 不保存</span>
      </div>

      {loadError !== null ? (
        <div className="border-l-2 border-rose-400 bg-rose-50/60 py-3 pl-4 text-sm">
          <p className="font-medium text-rose-900">读取测试词库失败</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800">
            {loadError}
          </pre>
        </div>
      ) : (
        <PreviewStudySession items={items} />
      )}
    </main>
  );
}
