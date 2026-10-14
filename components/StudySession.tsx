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
import Link from "next/link";
import { useEffect, useState } from "react";
import { RatingButtons } from "@/components/RatingButtons";
import { WordCard } from "@/components/WordCard";
import {
  createInitialProgress,
  describeInterval,
  scheduleNextReview,
  type ReviewInput,
} from "@/lib/spaced-repetition";
import {
  RATING_LABELS,
  type ReviewRating,
  type SaveReviewResult,
  type Word,
} from "@/types";

/** 一条学习项：一个单词 + 你当前对它的进度 */
export type StudyItem = {
  word: Word;
  progress: ReviewInput;
  /** 这是本轮的新词（true）还是到期的复习词（false） */
  isNew?: boolean;
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
  /** 正在后台同步的作答数量，用来显示「同步中…」 */
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [finished, setFinished] = useState(false);

  /**
   * 保存失败、还没补上的作答。
   *
   * 【为什么要记这个】
   * 这个组件现在是「点了立刻翻到下一个词，保存放到后台做」——
   * 这样界面不会再等网络（每点一次要等半秒，背 20 个词就是 10 秒）。
   * 但代价是：失败时不能把人拦在当场。所以失败的要记下来，
   * 在页面顶部明确提示，并给一个「重试」按钮，绝不能悄悄丢掉。
   */
  const [failedSaves, setFailedSaves] = useState<
    Array<{ wordId: number; rating: ReviewRating }>
  >([]);

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
      if (finished) return;

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
    const newCount = items.filter((item) => item.isNew === true).length;
    const reviewCount = items.length - newCount;

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-2xl font-bold text-slate-900">🎉 这一轮背完了</p>

        <div className="mt-6 flex justify-center gap-8">
          <div>
            <p className="text-3xl font-bold text-slate-900">{reviewCount}</p>
            <p className="mt-1 text-xs text-slate-500">复习旧词</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-slate-900">{newCount}</p>
            <p className="mt-1 text-xs text-slate-500">学习新词</p>
          </div>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          这些词的复习时间已经排好了，明天回来会先复习到期的。
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href="/"
            className={
              "w-full max-w-xs rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white " +
              "transition hover:bg-slate-700"
            }
          >
            返回首页看统计
          </Link>
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setRevealed(false);
              setFinished(false);
              setAnsweredCount(0);
              setFeedback(null);
            }}
            className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
          >
            再来一轮（进度保留）
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-400">
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

  /** 把一条失败记录加进待重试列表（同一条不重复添加） */
  function markFailed(wordId: number, rating: ReviewRating, message: string) {
    setError(message);
    setFailedSaves((prev) =>
      prev.some((item) => item.wordId === wordId && item.rating === rating)
        ? prev
        : [...prev, { wordId, rating }],
    );
  }

  /** 把一次作答交给服务器保存。失败只记录，不阻塞界面。 */
  async function persistRating(wordId: number, rating: ReviewRating) {
    setPendingCount((count) => count + 1);
    try {
      const result = await onRate(wordId, rating);
      if (!result.ok) {
        markFailed(wordId, rating, result.error);
        return;
      }
      // 成功：把它从待重试列表里移掉
      setFailedSaves((prev) =>
        prev.filter(
          (item) => !(item.wordId === wordId && item.rating === rating),
        ),
      );
    } catch (cause) {
      markFailed(
        wordId,
        rating,
        cause instanceof Error ? cause.message : "保存失败，请检查网络。",
      );
    } finally {
      setPendingCount((count) => count - 1);
    }
  }

  /**
   * 作答。
   *
   * 【这里做过一次重要改动：先翻页，再保存】
   * 原来的写法是「等服务器确认保存成功，才翻到下一个词」。
   * 那意味着每点一次都要等一次完整往返：
   *   浏览器 → 服务器 → 数据库(4 次串行) → 返回，大约半秒。
   * 背 20 个词就白等 10 秒，感觉就是「卡」。
   *
   * 现在改成：立刻更新界面并翻页，保存丢到后台去做。
   * 点击的反馈变成瞬时的，跟网速无关。
   * 代价是失败时不能把人拦在当场 —— 所以失败会被记下来，
   * 在页面顶部明确提示并提供「重试」，绝不悄悄丢掉。
   */
  function handleRate(rating: ReviewRating) {
    if (currentItem === undefined) return;

    const now = new Date();
    const before = progressMap[currentItem.word.id] ?? createInitialProgress();
    const after = scheduleNextReview(before, rating, now);

    setError(null);
    setProgressMap((prev) => ({ ...prev, [currentItem.word.id]: after }));
    setFeedback(
      `${RATING_LABELS[rating]} · 下次复习：${describeInterval(
        now,
        new Date(after.next_review_time),
      )}`,
    );
    setAnsweredCount((count) => count + 1);

    // 后台保存：故意不 await，界面不等它
    void persistRating(currentItem.word.id, rating);

    // 立刻前进到下一个词；已经是最后一个就进入总结页
    if (index + 1 >= items.length) {
      setFinished(true);
    } else {
      setIndex(index + 1);
      setRevealed(false);
    }
  }

  /** 把之前没保存成功的作答重新提交一遍 */
  async function retryFailedSaves() {
    const pending = [...failedSaves];
    setError(null);
    for (const item of pending) {
      await persistRating(item.wordId, item.rating);
    }
  }

  const progressPercent = Math.round((index / items.length) * 100);

  return (
    <div className="space-y-4">
      {/* ---- 顶部进度 ---- */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            第 {index + 1} / {items.length} 个
          </span>
          <span>已作答 {answeredCount} 个</span>
        </div>

        <div
          role="progressbar"
          aria-label="本轮学习进度"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={items.length}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        >
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
        isNew={currentItem.isNew}
      />

      {revealed && (
        <RatingButtons
          onRate={(rating) => void handleRate(rating)}
          hints={hints}
        />
      )}

      {/*
        aria-live="polite" 让读屏软件在内容变化时朗读出来，
        不会像 role="alert" 那样粗暴打断。
        min-h 是为了固定这一块的高度，避免出现提示时页面跳动。
      */}
      <div
        aria-live="polite"
        className="min-h-[20px] text-center text-sm"
      >
        {pendingCount > 0 ? (
          <span className="text-slate-400">同步中…</span>
        ) : feedback !== null ? (
          <span className="text-slate-500">{feedback}</span>
        ) : null}
      </div>

      {/*
        保存失败的提示。
        因为现在是「先翻页、后保存」，失败时没法把人拦在当场，
        所以这里必须显眼地告诉用户「有一些没存上」，并给一个重试按钮。
        换句话说：界面变快了，但不能因此悄悄丢数据。
      */}
      {failedSaves.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
        >
          <p className="font-medium">
            有 {failedSaves.length} 个词没能保存成功
          </p>
          <p className="mt-1 text-xs leading-5">
            这些词的作答还没记进数据库。请检查网络后点下面的按钮重试 ——
            不重试的话，这几个词下次还会当成没背过。
          </p>
          {error !== null && (
            <p className="mt-1 text-xs opacity-80">{error}</p>
          )}
          <button
            type="button"
            onClick={() => void retryFailedSaves()}
            className={
              "mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white " +
              "transition hover:bg-rose-800 disabled:opacity-50"
            }
            disabled={pendingCount > 0}
          >
            {pendingCount > 0 ? "重试中…" : "重试保存"}
          </button>
        </div>
      )}
    </div>
  );
}
