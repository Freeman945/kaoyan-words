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
import { StarRating } from "@/components/StarRating";
import { WordCard } from "@/components/WordCard";
import {
  createInitialProgress,
  describeInterval,
  scheduleNextReview,
  shouldRequeueInSession,
  starsOf,
  type ReviewInput,
} from "@/lib/spaced-repetition";
import {
  countWaiting,
  insertDeferred,
  nextPlayableIndex,
} from "@/lib/session-queue";
import {
  RESUME_COOKIE,
  RESUME_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/study-resume";
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
  /**
   * 这个词在本轮里已经被重新排过几次队。
   * 用来防止「一直点不认识」导致它无限循环出现。
   */
  requeuedCount?: number;
  /**
   * 到这个毫秒时间戳之后，才允许它再次出现。
   *
   * 【为什么必须有这个字段】
   * 原来的做法是「把间隔短的词重新塞回队尾」，那只保证「本轮还会再出现」，
   * 不保证**真的隔了那么久**。队列短的时候，标着「5 分钟后」的词
   * 20 秒后又冒出来了 —— 间隔形同虚设。
   *
   * 现在值来自 after.next_review_time（艾宾浩斯算出的真实间隔），
   * 没到点就不许出现。具体判断在 lib/session-queue.ts 里（有测试）。
   *
   * undefined = 正常队列里的词，随时可以作答。
   */
  eligibleAt?: number;
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

  /**
   * 本轮实际要走的队列。
   *
   * 【为什么不能直接用外面传进来的 items】
   * 因为艾宾浩斯的前几档只有 1 / 5 / 15 分钟。如果一个词被排到
   * 「5 分钟后再见」，而本轮队列是固定的，那它在这一次学习里就
   * 永远不会再出现 —— 只能等明天打开网站，那时已经逾期了，
   * 前三档等于白设。
   *
   * 所以这里用一个「会变长的队列」：间隔很短的词，会被重新排进队列，
   * 在本轮里再考你一次。这才是艾宾浩斯曲线真正起作用的地方。
   *
   * 【队列结构的不变式】
   *   [ 正常词（没有 eligibleAt，随时可答）
   *   | 重新排队的词（有 eligibleAt，按到点时间升序） ]
   * 排序保证在 lib/session-queue.ts 的 insertDeferred 里，有测试盯着。
   */
  const [queue, setQueue] = useState<StudyItem[]>(items);
  /** 正在后台同步的作答数量，用来显示「同步中…」 */
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  /**
   * 上一次作答让星级变了多少（+1 / −1 / 0）。
   *
   * 【为什么显示「变化量」而不是「当前几颗星」】
   * 单词卡上方已经在显示**当前这个词**的星级了。如果下面提示行再显示一个
   * 「几颗星」，两个数字挨在一起会被误读成同一个词的两种说法
   * （用户看到「熟练度 ★☆☆☆☆」和「★★★★☆」并排，就会问
   * 「同一个词怎么有两个熟练度」）。
   * 显示 +1 / −1 就不会有歧义 —— 那是「刚才那一下的效果」，不是「现在几颗」。
   */
  const [feedbackStarDelta, setFeedbackStarDelta] = useState(0);
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

  /**
   * 正在「回顾」第几个词（null = 正常作答模式）。
   *
   * 【为什么单独一个 state，而不是直接把 index 往回移】
   * index 是「作答指针」：它决定下一个要答的是谁、进度条走到哪、
   * 什么时候算背完。
   * 如果把它往回移，再点一次按钮就会把同一个词答第二遍 ——
   * 复习次数、星级、下次时间全都会算错，数据就脏了。
   *
   * 所以回顾是**只读**的：单独记一个位置，只影响显示，不影响作答。
   */
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

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

      /*
       * 左右方向键 = 往前 / 往后翻看。
       * 在回顾模式下，空格和 1/2/3 都不作答（见下面的 return），
       * 否则同一个词会被答第二遍。
       */
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const from = reviewIndex ?? index;
        if (from > 0) setReviewIndex(from - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (reviewIndex === null) return;
        // 翻回到作答位置就退出回顾模式
        if (reviewIndex + 1 >= index) setReviewIndex(null);
        else setReviewIndex(reviewIndex + 1);
        return;
      }

      // 回顾模式下不改答案
      if (reviewIndex !== null) return;

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

  /*
   * 记住「我现在停在哪个词」。
   *
   * 写在 cookie 而不是数据库：它只是**界面位置**，不是学习进度 ——
   * 进度（复习次数、星级、下次时间）已经存在数据库里了。
   * 放 cookie 的好处是服务端也读得到，所以下次打开时会在
   * **返回队列之前**就把它排到最前面，真正实现
   * 「退出去是 book，回来还是 book」，而且不会闪一下才到位。
   *
   * 注意记的是 index（作答位置），不是 reviewIndex ——
   * 你往回翻看的时候，恢复位置仍然应该是「你答到哪了」。
   */
  useEffect(() => {
    const item = queue[index];
    if (item === undefined) return;

    document.cookie =
      `${RESUME_COOKIE}=${item.word.id}; path=/; ` +
      `max-age=${RESUME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  }, [queue, index]);

  /*
   * 切回页面时，自动把没保存成功的作答再试一次。
   *
   * 手机在后台会冻结页面，期间的请求可能被系统掐断。
   * 等你切回来（visibilitychange → visible），网络基本已经恢复，
   * 这时候重试成功率很高 —— 不用你记得去点那个「重试」按钮。
   *
   * 故意不写依赖数组：每次渲染都重新注册，
   * 这样监听函数里读到的 failedSaves 永远是最新的。
   */
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (failedSaves.length === 0) return;
      void retryFailedSaves();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
        没有需要学习的单词。
      </div>
    );
  }

  const currentItem = queue[index];

  /*
   * 实际要显示哪一个词。
   * 回顾模式下显示 queue[reviewIndex]，否则就是当前要作答的那个。
   * currentItem（作答目标）和 viewingItem（显示目标）刻意分开 ——
   * 这样「往回看」永远不会影响「答到哪了」。
   */
  const viewingIndex = reviewIndex ?? index;
  const viewingItem: StudyItem = queue[viewingIndex] ?? currentItem;
  const isReviewing = reviewIndex !== null;

  // 全部背完时的总结
  if (finished) {
    const newCount = items.filter((item) => item.isNew === true).length;
    const reviewCount = items.length - newCount;
    /*
     * 本轮是不是被「还没到点」截断的？
     * 队列短的时候会出现：全背完了，但有几个标着「5 分钟后」的词还没到点。
     * 不告诉用户一声，他会以为「怎么才背了几个就结束了」。
     */
    const waitingCount = countWaiting(queue, index + 1, Date.now());

    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
        <p className="text-lg font-semibold text-zinc-900">本轮完成</p>

        <div className="mt-8 flex justify-center gap-10">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-zinc-900">
              {reviewCount}
            </p>
            <p className="mt-1 text-xs text-zinc-500">复习</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums text-zinc-900">
              {newCount}
            </p>
            <p className="mt-1 text-xs text-zinc-500">新词</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums text-zinc-900">
              {answeredCount}
            </p>
            <p className="mt-1 text-xs text-zinc-500">作答</p>
          </div>
        </div>

        {waitingCount > 0 && (
          <p className="mt-6 text-xs text-zinc-400">
            还有 {waitingCount} 个词没到重来的时间，下次打开会继续
          </p>
        )}

        <div className="mt-10 flex flex-col items-center gap-3">
          <Link
            href="/"
            className={
              "inline-flex h-10 items-center rounded-lg bg-zinc-900 px-6 text-sm font-medium " +
              "text-white transition-colors hover:bg-zinc-700"
            }
          >
            返回
          </Link>
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              // 队列也要恢复成最开始那样（把本轮中途加进去的重复项清掉）
              setQueue(items);
              setRevealed(false);
              setFinished(false);
              setAnsweredCount(0);
              setFeedback(null);
              setFeedbackStarDelta(0);
              setReviewIndex(null);
            }}
            // 「进度保留」这四个字保留着：不然会以为点一下会把学过的东西清掉
            className="text-xs text-zinc-400 transition-colors hover:text-zinc-700"
          >
            再来一轮（进度保留）
          </button>
        </div>
      </div>
    );
  }

  const currentProgress =
    progressMap[viewingItem.word.id] ?? createInitialProgress();

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

  /**
   * 把一次作答交给服务器保存。失败只记录，不阻塞界面。
   *
   * ══════════ 自动重试 ══════════
   * 手机上切出去看邮件、锁屏、切到别的 App，都会让正在飞的请求被系统掐断。
   * 这类失败绝大多数是**暂时的** —— 等一秒再试就好了。
   *
   * 所以这里先自己重试两次，两次都失败才真的把「未保存」提示给你。
   * 你不该为一次网络抖动去按按钮。
   *
   * 【重试为什么是安全的】
   * 服务端有幂等保护（见 lib/progress.ts 里 saveReview 的第 0 步）：
   * 即使第一次其实已经存进去了，重试也不会把它算成两次。
   *
   * 【什么样的失败不重试】
   * `result.ok === false` 是业务层面的失败（比如登录过期、
   * 表不存在），这种情况重试再多次也没用，直接报出来。
   */
  async function persistRating(wordId: number, rating: ReviewRating) {
    // 三次尝试：立刻、1 秒后、2 秒后
    const delays = [0, 1000, 2000];
    setPendingCount((count) => count + 1);

    try {
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        const delay = delays[attempt];
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        try {
          const result = await onRate(wordId, rating);

          if (result.ok) {
            // 成功：把它从待重试列表里移掉
            setFailedSaves((prev) =>
              prev.filter(
                (item) => !(item.wordId === wordId && item.rating === rating),
              ),
            );
            return;
          }

          // 业务失败：重试没用，直接报
          markFailed(wordId, rating, result.error);
          return;
        } catch (cause) {
          // 网络层失败：还有重试机会就继续，最后一次才报
          if (attempt === delays.length - 1) {
            markFailed(
              wordId,
              rating,
              cause instanceof Error
                ? cause.message
                : "保存失败，请检查网络。",
            );
          }
        }
      }
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
    // 回顾模式下不作答 —— 那个词已经答过了，再答一次会把数据算错
    if (reviewIndex !== null) return;

    const now = new Date();
    const before = progressMap[currentItem.word.id] ?? createInitialProgress();
    const after = scheduleNextReview(before, rating, now);

    setError(null);
    setProgressMap((prev) => ({ ...prev, [currentItem.word.id]: after }));
    setAnsweredCount((count) => count + 1);

    // 后台保存：故意不 await，界面不等它
    void persistRating(currentItem.word.id, rating);

    /*
     * 决定这个词要不要在「本轮之内」再出现一次。
     *
     * 这是艾宾浩斯复习法真正起作用的关键一步，我一开始漏掉了：
     * 前几档间隔只有 1 / 5 / 15 分钟，如果本轮队列是固定的，
     * 这些档位永远不会真的发生 —— 只能等明天再打开网站，
     * 那时它早就逾期了，前三档等于白设。
     *
     * 判断逻辑抽在 lib/spaced-repetition.ts 里（有测试盯着），
     * 这里只负责按结论操作队列。
     */
    const alreadyRequeued = currentItem.requeuedCount ?? 0;
    const willRequeue = shouldRequeueInSession(
      after.next_review_time,
      now,
      alreadyRequeued,
    );

    /*
     * 重新排队时记下「到点时间」—— 直接用算法算出的下次复习时间。
     *
     * 这一步是「5 分钟就真的等 5 分钟」的关键：
     * 以前只是把它放回队尾，队列短的时候几秒后就又出现了。
     */
    const eligibleAt = willRequeue
      ? new Date(after.next_review_time).getTime()
      : undefined;

    let nextQueue = queue;
    if (willRequeue) {
      // insertDeferred 会把尾部按到点时间排好序（纯函数，有测试）
      nextQueue = insertDeferred(queue, {
        ...currentItem,
        progress: after,
        requeuedCount: alreadyRequeued + 1,
        eligibleAt,
      });
      setQueue(nextQueue);
    }

    const gapLabel = describeInterval(now, new Date(after.next_review_time));
    setFeedback(
      `${RATING_LABELS[rating]} · ${gapLabel}` +
        (willRequeue ? " · 本轮重现" : ""),
    );
    // 记录星级的变化量，显示在提示行末尾
    setFeedbackStarDelta(starsOf(after) - starsOf(before));

    // 作答完自动退出回顾模式（正常流程不会停在回顾里，但防御一下）
    setReviewIndex(null);

    /*
     * 前进到下一个「现在就能作答」的词。
     *
     * 如果下一个是重新排队的词、但还没到点 —— 就结束本轮，
     * 而不是让你盯着倒计时等。
     * 那些词的 next_review_time 已经写进数据库了，
     * 下次打开会正常进入复习（并且会出现在「待复习」里）。
     */
    const nextIndex = nextPlayableIndex(nextQueue, index + 1, Date.now());
    if (nextIndex === -1) {
      setFinished(true);
    } else {
      setIndex(nextIndex);
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

  /*
   * 进度按「队列」算，而不是按最开始那份词表算。
   * 因为短间隔的词会被重新排进队列，队列是会长大的 ——
   * 显示「第几个 / 共几个」比显示一个会跳动的剩余量更不容易让人困惑。
   */
  const progressPercent = Math.round((index / queue.length) * 100);

  return (
    <div className="space-y-4">
      {/* ── 顶部：上一个 + 进度 ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const from = reviewIndex ?? index;
            if (from > 0) setReviewIndex(from - 1);
          }}
          disabled={(reviewIndex ?? index) === 0}
          title="看上一个（←）"
          className={
            "shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors " +
            "hover:bg-zinc-100 hover:text-zinc-900 " +
            "disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
          }
        >
          ← 上一个
        </button>

        <div
          role="progressbar"
          aria-label="本轮学习进度"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={queue.length}
          className="h-0.5 flex-1 overflow-hidden rounded-full bg-zinc-200"
        >
          <div
            className="h-full rounded-full bg-zinc-900 transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <span className="shrink-0 text-xs tabular-nums text-zinc-400">
          {isReviewing
            ? `回顾 ${viewingIndex + 1}`
            : `${index + 1} / ${queue.length}`}
        </span>
      </div>

      <WordCard
        word={viewingItem.word}
        // 回顾时直接显示释义 —— 你往回翻就是想再看一眼意思，
        // 再让你按一次空格是多余的
        revealed={isReviewing || revealed}
        onReveal={() => setRevealed(true)}
        isNew={viewingItem.isNew}
      />

      {/*
        这个词当前的星级。
        必须在「作答之前」就显示 —— 新词第一次出现时应当看到它是 3 颗，
        而不是等答完才第一次看到星级。
      */}
      <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
        <span>熟练度</span>
        <StarRating stars={starsOf(currentProgress)} />
      </div>

      {isReviewing ? (
        /*
         * 回顾模式：只读。
         *
         * 刻意**不显示作答按钮** —— 这个词已经答过了，
         * 再答一次会把复习次数、星级、下次时间全算错。
         * 所以这里只给一个「回到当前」的出口。
         */
        <button
          type="button"
          onClick={() => setReviewIndex(null)}
          className={
            "flex w-full items-center justify-center rounded-lg border border-zinc-300 py-3 " +
            "text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
          }
        >
          回到当前 →
        </button>
      ) : (
        revealed && (
          <RatingButtons
            onRate={(rating) => void handleRate(rating)}
            hints={hints}
          />
        )
      )}

      {/*
        aria-live="polite" 让读屏软件在内容变化时朗读，
        不像 role="alert" 那样粗暴打断。
        min-h 固定高度，避免出现提示时页面跳动。
      */}
      <div
        aria-live="polite"
        className="flex min-h-[20px] items-center justify-center gap-2 text-center text-xs text-zinc-500"
      >
        {isReviewing ? null : pendingCount > 0 ? (
          <span className="text-zinc-400">保存中</span>
        ) : feedback !== null ? (
          <>
            <span className="tabular-nums">{feedback}</span>
            {/* 只显示变化量。0 就不写 —— 没变化没什么可说的 */}
            {feedbackStarDelta !== 0 && (
              <span
                className={
                  "tabular-nums " +
                  (feedbackStarDelta > 0 ? "text-amber-600" : "text-zinc-500")
                }
              >
                {feedbackStarDelta > 0 ? "+" : "−"}
                {Math.abs(feedbackStarDelta)} 星
              </span>
            )}
          </>
        ) : null}
      </div>

      {/*
        保存失败提示。
        现在是「先翻页、后保存」，失败时没法把人拦在当场，
        所以必须明确说出来并让重试 —— 界面变快了，但不能因此悄悄丢数据。

        失败原因单独一行、允许换行显示：
        之前用 truncate 截断，手机上等于把错误信息藏了 ——
        出问题时看不到原因，只能瞎猜。
      */}
      {failedSaves.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{failedSaves.length} 个词未保存</span>
            <button
              type="button"
              onClick={() => void retryFailedSaves()}
              disabled={pendingCount > 0}
              className={
                "shrink-0 rounded-md bg-rose-700 px-3 py-1 text-xs font-medium text-white " +
                "transition-colors hover:bg-rose-800 disabled:opacity-50"
              }
            >
              {pendingCount > 0 ? "重试中" : "重试"}
            </button>
          </div>

          {error !== null && (
            <p className="mt-1 text-xs break-words opacity-70">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
