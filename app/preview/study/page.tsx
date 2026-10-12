import type { Metadata } from "next";
import Link from "next/link";
import { PreviewStudySession } from "@/components/PreviewStudySession";
import type { StudyItem } from "@/components/StudySession";
import { createInitialProgress } from "@/lib/spaced-repetition";
import { loadSeedWords } from "@/lib/words";

export const metadata: Metadata = {
  title: "背单词预览 · 考研英语背单词",
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
      // 预览时把所有单词都当成「从没学过」的新词
      progress: createInitialProgress(),
    }));
  } catch (cause) {
    loadError = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">背单词预览</h1>
        <Link
          href="/"
          className="text-sm text-slate-500 underline underline-offset-2"
        >
          返回首页
        </Link>
      </div>

      <div className="rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
        <p className="font-medium">🧪 预览模式：不会保存任何进度</p>
        <p className="mt-1">
          数据来自本地 <code className="rounded bg-white/70 px-1">data/words-seed.csv</code>{" "}
          的 40 个测试单词。按钮下方的「10 分钟后 / 1 天后 / 3 天后」
          是真实的复习算法算出来的。配好数据库后，阶段 5 会做出真正会保存进度的版本。
        </p>
      </div>

      {loadError !== null ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-medium">读取测试词库失败</p>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {loadError}
          </pre>
        </div>
      ) : (
        <PreviewStudySession items={items} />
      )}

      <p className="text-center text-xs text-slate-400">
        小技巧：空格键显示释义，然后按 1 / 2 / 3 作答，长时间背的时候不用碰鼠标。
      </p>
    </main>
  );
}
