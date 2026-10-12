/**
 * 间隔复习算法（Spaced Repetition）。
 *
 * 这个文件是本项目的「大脑」：它决定一个单词下次什么时候该复习。
 * 它被单独抽出来，原因有两个：
 *   1. 页面组件里只调用它，不关心细节 —— 以后想改复习节奏，只改这个文件；
 *   2. 它是「纯函数」：给同样的输入，永远得到同样的输出，不碰数据库、
 *      不看当前时间（时间由调用方传进来）。所以能被自动测试覆盖。
 *
 * ── 复习规则 ──────────────────────────────────────────
 *   不认识(again) → 10 分钟后再出现，连续答对次数清零
 *   模糊(hard)    → 1 天后再出现，连续答对次数清零
 *   认识(good)    → 按连续答对次数取间隔：3 → 7 → 14 → 30 → 60 天
 *   连续答对满 4 次（走完 3/7/14/30 四档） → 标记为「已掌握」
 * ─────────────────────────────────────────────────────
 *
 * 这是一个刻意简化的版本。真实的 SM-2 / FSRS 算法还会根据「这个单词对
 * 你有多难」动态调整间隔，但复杂度高很多。先用简单版跑起来，
 * 等你背了几个月、有了真实数据，再决定要不要升级。
 */
import type { Familiarity, ReviewRating, WordProgressRow } from "@/types";

/** 连续答对时使用的间隔（天），按顺序取用 */
export const CORRECT_INTERVALS_DAYS: readonly number[] = [3, 7, 14, 30, 60];

/** 「不认识」时隔多久再出现（分钟） */
export const AGAIN_INTERVAL_MINUTES = 10;

/** 「模糊」时隔多久再出现（天） */
export const HARD_INTERVAL_DAYS = 1;

/** 连续答对几次算「已掌握」 */
export const MASTERED_STREAK = 4;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * 算法需要的输入：只是进度记录的一部分字段。
 * 用 Pick 从 WordProgressRow 里挑，好处是字段名永远不会写错。
 */
export type ReviewInput = Pick<
  WordProgressRow,
  | "familiarity"
  | "consecutive_correct"
  | "review_count"
  | "correct_count"
  | "wrong_count"
>;

/** 算法的输出：可以直接写回数据库的字段 */
export type ReviewResult = {
  familiarity: Familiarity;
  consecutive_correct: number;
  review_count: number;
  correct_count: number;
  wrong_count: number;
  last_review_time: string;
  next_review_time: string;
};

/** 一个单词从未被复习过时的初始进度 */
export function createInitialProgress(): ReviewInput {
  return {
    familiarity: 0,
    consecutive_correct: 0,
    review_count: 0,
    correct_count: 0,
    wrong_count: 0,
  };
}

/**
 * 核心函数：根据「当前进度」和「这次的选择」，算出「新的进度和下次复习时间」。
 *
 * @param current 这个词目前的进度
 * @param rating  用户这次点了哪个按钮
 * @param now     当前时间。默认取系统时间；测试时会传入固定时间，
 *                这样结果才可预测 —— 这叫「依赖注入」。
 */
export function scheduleNextReview(
  current: ReviewInput,
  rating: ReviewRating,
  now: Date = new Date(),
): ReviewResult {
  // 三个分支共用的部分：复习次数一定 +1，上次复习时间一定是「现在」
  const base = {
    review_count: current.review_count + 1,
    correct_count: current.correct_count,
    wrong_count: current.wrong_count,
    last_review_time: now.toISOString(),
  };

  if (rating === "again") {
    // 完全不会：连击清零，10 分钟后再见一次
    return {
      ...base,
      familiarity: 0,
      consecutive_correct: 0,
      wrong_count: base.wrong_count + 1,
      next_review_time: new Date(
        now.getTime() + AGAIN_INTERVAL_MINUTES * MINUTE_MS,
      ).toISOString(),
    };
  }

  if (rating === "hard") {
    // 模糊：说明还没记牢，连击清零，退回 1 天
    return {
      ...base,
      familiarity: 1,
      consecutive_correct: 0,
      next_review_time: new Date(
        now.getTime() + HARD_INTERVAL_DAYS * DAY_MS,
      ).toISOString(),
    };
  }

  // 剩下的情况就是 rating === "good"（认识）
  const streak = current.consecutive_correct + 1;

  // 连击从 1 开始数，所以要减 1 才是数组下标。
  // 用 Math.min 防止超范围：连击超过 5 次后一直用最后一个间隔（60 天）。
  const intervalIndex = Math.min(streak - 1, CORRECT_INTERVALS_DAYS.length - 1);
  const days = CORRECT_INTERVALS_DAYS[intervalIndex];

  return {
    ...base,
    // 连击满 MASTERED_STREAK 次就升级为「已掌握」
    familiarity: streak >= MASTERED_STREAK ? 3 : 2,
    consecutive_correct: streak,
    correct_count: base.correct_count + 1,
    next_review_time: new Date(
      now.getTime() + days * DAY_MS,
    ).toISOString(),
  };
}

/**
 * 判断一个单词现在是不是该复习了。
 *
 * @param nextReviewTime 数据库里的 next_review_time
 * @param now 当前时间
 * @returns 从没复习过（null）也算「该复习」—— 那就是今天的新词
 */
export function isDue(nextReviewTime: string | null, now: Date = new Date()): boolean {
  if (!nextReviewTime) return true;
  return new Date(nextReviewTime).getTime() <= now.getTime();
}

/**
 * 把两个时间的差距说成中文，用于按钮点完后的提示，例如「3 天后」。
 * 之所以放在这个文件里，是因为「间隔多久」本身就是算法的一部分。
 */
export function describeInterval(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime();

  if (diffMs < MINUTE_MS) {
    return "马上";
  }
  if (diffMs < 60 * MINUTE_MS) {
    return `${Math.round(diffMs / MINUTE_MS)} 分钟后`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.round(diffMs / (60 * MINUTE_MS))} 小时后`;
  }
  return `${Math.round(diffMs / DAY_MS)} 天后`;
}
