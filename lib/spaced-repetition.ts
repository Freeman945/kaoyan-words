/**
 * 艾宾浩斯遗忘曲线复习算法（Ebbinghaus forgetting curve）。
 *
 * 这个文件是本项目的「大脑」：它决定一个单词下次什么时候该复习。
 * 它被单独抽出来，原因有两个：
 *   1. 页面组件里只调用它，不关心细节 —— 以后想改复习节奏，只改这个文件；
 *   2. 它是「纯函数」：给同样的输入，永远得到同样的输出，不碰数据库、
 *      不看当前时间（时间由调用方传进来）。所以能被自动测试覆盖。
 *
 * ══════════════════════════════════════════════════════
 *  艾宾浩斯复习阶梯（间隔依次拉长，这是本算法的核心）
 * ══════════════════════════════════════════════════════
 *    第 1 次答对 → 5 分钟后
 *    第 2 次答对 → 30 分钟后
 *    第 3 次答对 → 12 小时后
 *    第 4 次答对 → 1 天后
 *    第 5 次答对 → 2 天后
 *    第 6 次答对 → 4 天后
 *    第 7 次答对 → 7 天后
 *    第 8 次答对 → 15 天后   ← 到这里算「已掌握」
 *    第 9 次答对 → 30 天后
 *    第 10 次答对 → 60 天后
 *    第 11 次及以后 → 120 天后（约 4 个月）
 *
 *  三个按钮的作用：
 *    认识   → 往上升一档（间隔变长）
 *    模糊   → 往下退一档（间隔变短），但不会一次退回原点
 *    不认识 → 直接归零，5 分钟后重来
 *
 * 【为什么前面几档要精确到分钟和小时】
 * 艾宾浩斯曲线的特点就是「刚记完忘得最快」。所以新词必须在当天内
 * 反复碰几次（5 分钟、30 分钟、12 小时），把第一波遗忘压住；
 * 拖到第二天再见，等于白白多忘一轮。
 * ══════════════════════════════════════════════════════
 *
 * 这是一个刻意保持简单的版本（比 SM-2 / FSRS 好懂很多）。
 * 等你背了几个月、有了真实数据，再决定要不要升级成更复杂的算法。
 */
import type { Familiarity, ReviewRating, WordProgressRow } from "@/types";

/**
 * 复习间隔阶梯，单位是**分钟**。
 * 用分钟作为统一单位，是为了让「5 分钟」和「120 天」能放进同一个数组里。
 */
export const REVIEW_INTERVALS_MINUTES: readonly number[] = [
  5, // 1. 5 分钟
  30, // 2. 30 分钟
  12 * 60, // 3. 12 小时
  24 * 60, // 4. 1 天
  2 * 24 * 60, // 5. 2 天
  4 * 24 * 60, // 6. 4 天
  7 * 24 * 60, // 7. 7 天
  15 * 24 * 60, // 8. 15 天
  30 * 24 * 60, // 9. 30 天
  60 * 24 * 60, // 10. 60 天
  120 * 24 * 60, // 11. 120 天（约 4 个月）
];

/** 「不认识」时隔多久重新出现（分钟）—— 马上把这一波遗忘压住 */
export const AGAIN_INTERVAL_MINUTES = 5;

/**
 * 连续答对几次算「已掌握」。
 * 8 对应阶梯里的 15 天档：能连续记住到「半个月后还记得」，
 * 才算真的进脑子了。
 */
export const MASTERED_STREAK = 8;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
 * 把「第几档」换算成实际间隔分钟数。
 * 超出范围就取最后一档（背得再熟也不会无限期拖下去）。
 */
function intervalMinutesAtStep(step: number): number {
  const index = Math.min(Math.max(step, 0), REVIEW_INTERVALS_MINUTES.length - 1);
  return REVIEW_INTERVALS_MINUTES[index];
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
    // 完全不会：连击归零，5 分钟后马上再来一次
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
    /**
     * 模糊：说明记不牢，往下退一档（但不退到原点）。
     *
     * 为什么是「退一档」而不是「退回 1 天」：
     * 一个已经能记住 15 天的词，只是这次没想起来，没必要直接打回原形；
     * 退一档到 7 天更合理，既加了复习密度，也不会让你白背。
     */
    const steppedBack = Math.max(0, current.consecutive_correct - 1);
    const minutes = intervalMinutesAtStep(steppedBack - 1);

    return {
      ...base,
      familiarity: 1,
      consecutive_correct: steppedBack,
      next_review_time: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
    };
  }

  // 剩下的情况就是 rating === "good"（认识）
  const streak = current.consecutive_correct + 1;

  // 连击从 1 开始数，所以减 1 才是数组下标；
  // 超范围时 intervalMinutesAtStep 内部会取最后一档。
  const minutes = intervalMinutesAtStep(streak - 1);

  return {
    ...base,
    // 连击满 MASTERED_STREAK 次（间隔排到 15 天）就升级为「已掌握」
    familiarity: streak >= MASTERED_STREAK ? 3 : 2,
    consecutive_correct: streak,
    correct_count: base.correct_count + 1,
    next_review_time: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
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
 * 把两个时间的差距说成中文，用于按钮点完后的提示，例如「15 天后」。
 * 之所以放在这个文件里，是因为「间隔多久」本身就是算法的一部分。
 */
export function describeInterval(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime();

  if (diffMs < MINUTE_MS) {
    return "马上";
  }
  if (diffMs < HOUR_MS) {
    return `${Math.round(diffMs / MINUTE_MS)} 分钟后`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.round(diffMs / HOUR_MS)} 小时后`;
  }
  return `${Math.round(diffMs / DAY_MS)} 天后`;
}

/**
 * 把整条复习阶梯翻译成中文，用于在界面上展示「这个网站打算怎么帮你记」。
 * 返回的每一项形如 { step: 1, label: "5 分钟后", mastered: false }。
 */
export function describeReviewPlan(): Array<{
  step: number;
  label: string;
  mastered: boolean;
}> {
  return REVIEW_INTERVALS_MINUTES.map((minutes, index) => ({
    step: index + 1,
    label: describeInterval(new Date(0), new Date(minutes * MINUTE_MS)),
    mastered: index + 1 >= MASTERED_STREAK,
  }));
}
