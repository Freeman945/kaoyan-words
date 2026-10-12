"use client";

/**
 * 背单词的核心交互组件：一次显示一个词，作答后自动进入下一个。
 *
 * 【它和「保存到数据库」是分开的】
 * 这个组件通过 onRate 这个参数把「保存」这件事交给外面处理：
 *   - 预览页面传进来一个「什么都不做」的函数（所以能立刻演示，不需要数据库）
 *   - 正式的背单词页面传进来一个 Server Action（真正写进 Supabase）
 * 组件本身不用改一行。这样「界面逻辑」和「数据存储」就解耦了。
 */
import { useEffect, useState } from "react";
import { RatingButtons } from "@/components/RatingButtons";
import { WordCard } from "@/components/WordCard";
import {
  createInitialProgress,
  describeInterval,
  scheduleNextReview,
  type ReviewInput,
} from "@/lib/spaced-repetition";
import { RATING_LABELS, type ReviewRating, type SaveReviewResult, type Word } from "@/types";

/** 一条学习项：一个单词 + 你当前对它的进度 */
export type StudyItem = {
  word: Word;
  progress: ReviewInput;
};

type StudySessionProps = {
  items: StudyItem[];
  /**
   * 保存一次作答。
   *
   * 返回 { ok: false } 时，组件会停在这个词不动 ——
   * 避免出现「以为背过了、其实没记上」的情况。
   */
  onRate: (wordId: number, rating: ReviewRating) => Promise<SaveReviewResult>;
};

const RATINGS: ReviewRating[] = ["again", "hard", "good"];

export function StudySession({ items, onRate }: StudySessionProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [finished, setFinished] = useState(false);

  // 每个单词当前的学习进度。初始值由外面传进来（正式页面会用数据库里的真实进度）。
  const [progressMap, setProgressMap] = useState<Record<number, ReviewInput>>(
    () => {
      const initial: Record<number, ReviewInput> = {};
      for (const item of items) {
        initial[item.word.id] = item.progress;
      }
      return initial;
    },
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (finished || isSaving) return;

      // 空格 = 显示释义
      if (event.code === "Space" && !revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;

      // 1 / 2 / 3 = 三个作答按钮
      const keyToRating: Record<string, ReviewRating> = {
        "1": "again",
        "2": "hard",
        "3": "good",
      };
      const rating = keyToRating[event.key];
      if (rating !== undefined) {
        event.preventDefault();
        void handleRate(rating);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // 这里故意不写依赖数组：每次渲染都重新注册，
    // 这样监听函数里读到的永远是最新的 state，不会拿到旧值。
  });

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
        没有需要学习的单词。
      </div>
    );
  }

  const currentItem = items[index];

  // 全部背完时的总结页
  if (finished) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-2xl font-bold text-slate-900">🎉 这一轮背完了</p>
        <p className="mt-2 text-slate-600">
          本轮共复习 <span className="font-semibold">{answeredCount}</span> 个单词。
        </p>
        {feedback !== null && (
          <p className="mt-4 text-sm text-slate-500">最后一条：{feedback}</p>
        )}
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setRevealed(false);
            setFinished(false);
            setAnsweredCount(0);
            setFeedback(null);
          }}
          className="mt-6 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          再来一轮
        </button>
        <p className="mt-3 text-xs text-slate-400">
          再来一轮时进度会保留，所以你会看到「认识」的间隔从 3 天慢慢变成
          7 天、14 天 —— 这就是间隔复习在起作用。
        </p>
      </div>
    );
  }

  const currentProgress =
    progressMap[currentItem.word.id] ?? createInitialProgress();

  /*
   * 用真实的复习算法，预先算出三个按钮各自的结果。
   *
   * 为什么可以放心在渲染时调用 new Date()？
   * 因为间隔永远是「从此刻起固定的一段时间」，所以标签恒为
   * 「10 分钟后」「1 天后」「3 天后」这类文字，和具体几点几分无关，
   * 不会出现服务端和浏览器渲染结果不一致的问题。
   */
  const hints = Object.fromEntries(
    RATINGS.map((rating) => {
      const now = new Date();
      const next = scheduleNextReview(currentProgress, rating, now);
      return [rating, describeInterval(now, new Date(next.next_review_time))];
    }),
  ) as Record<ReviewRating, string>;

  async function handleRate(rating: ReviewRating) {
    if (isSaving || currentItem === undefined) return;

    const now = new Date();
    const before = progressMap[currentItem.word.id] ?? createInitialProgress();
    const after = scheduleNextReview(before, rating, now);

    setIsSaving(true);
    setError(null);

    try {
      const result = await onRate(currentItem.word.id, rating);

      // 保存失败就停在这个词，不要往下走
      if (!result.ok) {
        setError(result.error);
        setIsSaving(false);
        return;
      }
    } catch (cause) {
      // 断网之类的意外情况，同样停住不动
      setError(
        cause instanceof Error ? cause.message : "保存失败，请检查网络后重试。",
      );
      setIsSaving(false);
      return;
    }

    setProgressMap((prev) => ({ ...prev, [currentItem.word.id]: after }));
    setFeedback(
      `${RATING_LABELS[rating]} · 下次复习：${describeInterval(
        now,
        new Date(after.next_review_time),
      )}`,
    );
    setAnsweredCount((count) => count + 1);
    setIsSaving(false);

    // 前进到下一个词；已经是最后一个就进入总结页
    if (index + 1 >= items.length) {
      setFinished(true);
    } else {
      setIndex(index + 1);
      setRevealed(false);
    }
  }

  // 顶部进度条
  const progressPercent = Math.round((index / items.length) * 100);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            第 {index + 1} / {items.length} 个
          </span>
          <span>已作答 {answeredCount} 个</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-slate-900 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <WordCard
        word={currentItem.word}
        revealed={revealed}
        onReveal={() => setRevealed(true)}
      />

      {revealed && (
        <RatingButtons
          onRate={(rating) => void handleRate(rating)}
          disabled={isSaving}
          hints={hints}
        />
      )}

      {feedback !== null && (
        <p className="text-center text-sm text-slate-500">{feedback}</p>
      )}

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}
