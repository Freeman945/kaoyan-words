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
 *    第 1 次答对 → 1 分钟后
 *    第 2 次答对 → 5 分钟后
 *    第 3 次答对 → 15 分钟后   ← 前三档都在「本轮学习之内」
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
 *    不认识 → 直接归零，1 分钟后重来
 *
 * 【为什么前三档要精确到分钟】
 * 艾宾浩斯曲线的特点就是「刚记完忘得最快」。所以新词必须在
 * **同一次学习之内**反复碰几次，把第一波遗忘压住。
 * 拖到第二天再见，等于白白多忘一轮。
 *
 * 【前三档必须配「本轮内重新排队」才有意义】
 * 这一点很关键，也是我一开始漏掉的：
 * 背单词页在打开时就把这一轮要背的词取好了，队列是固定的。
 * 如果没有「本轮内重新排队」的机制，那么一个被排到「5 分钟后」的词，
 * 在本轮里永远不会再出现 —— 它只会在明天打开网站时才冒出来，
 * 那时已经逾期一天了，前三档等于白设。
 * 所以 StudySession 组件会在间隔很短时，把词重新塞回本轮队列末尾。
 *
 * 【为什么把 12 小时这一档去掉了】
 * 你一次一般背十几分钟，不是三十分钟。原来的
 * 「5 分钟 → 30 分钟 → 12 小时」里，后两档根本落不到你实际的学习时段内，
 * 只会变成「明天再见」。现在改成 1 分钟 / 5 分钟 / 15 分钟三档，
 * 都在一次正常学习之内，够得着才有意义。
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
  1, // 1. 1 分钟——刚见过就再来一次
  5, // 2. 5 分钟
  15, // 3. 15 分钟——前三档都在一次正常学习之内
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
export const AGAIN_INTERVAL_MINUTES = 1;

/**
 * 间隔小于这个值的词，会在**本轮学习之内**重新排到队列末尾，
 * 而不是等到下次打开网站。见上面关于「前三档」的说明。
 *
 * 取 30 分钟：比阶梯里最长的一档（15 分钟）宽裕一点，
 * 保证前三档都会被重新排队。
 */
export const IN_SESSION_REQUEUE_MAX_MINUTES = 30;

/**
 * 一个词在一次学习里最多被重新排几次队。
 * 没有上限的话，一直点「不认识」会让这个词永远排在队尾，这一轮结束不了。
 */
export const MAX_IN_SESSION_REPEATS = 3;

/**
 * 判断一个刚作答完的词，要不要在**本轮之内**重新排到队列末尾。
 *
 * 【为什么必须有这个判断】
 * 前几档间隔只有 1 / 5 / 15 分钟。如果本轮队列是固定的，这些档位
 * 就永远不会真的发生 —— 只能等下次打开网站，那时它早就逾期了，
 * 等于白设。所以间隔短的词必须在本次学习里再考一遍。
 *
 * 两个条件同时满足才重排：
 *   1. 间隔确实短（不超过 IN_SESSION_REQUEUE_MAX_MINUTES）
 *   2. 这个词本轮还没被重排够 MAX_IN_SESSION_REPEATS 次
 *
 * @param nextReviewTime 刚算出来的下次复习时间
 * @param now 当前时间
 * @param alreadyRequeued 这个词本轮已经被重排过几次
 */
export function shouldRequeueInSession(
  nextReviewTime: string,
  now: Date,
  alreadyRequeued: number,
): boolean {
  const gapMinutes =
    (new Date(nextReviewTime).getTime() - now.getTime()) / MINUTE_MS;
  return (
    gapMinutes <= IN_SESSION_REQUEUE_MAX_MINUTES &&
    alreadyRequeued < MAX_IN_SESSION_REPEATS
  );
}

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

/** 星级熟练度的取值范围 */
export const MIN_STARS = 0;
export const MAX_STARS = 5;

/**
 * 新词的起始星级。
 * 取中间值 3：既不说「这个字我会」，也不说「这个字我不会」，
 * 因为刚见到它的时候本来就无从判断。
 */
export const INITIAL_STARS = 3;

/**
 * 由「答对次数」和「答错次数」算出星级熟练度。
 *
 * 规则（用户定的）：
 *   新词           → 3 颗（基础熟练度）
 *   点「认识」      → +1 颗
 *   点「不认识」    → -1 颗
 *   点「模糊」      → 不加不减
 *   范围           → 0 ~ 5 颗
 *
 * 【为什么不用单独存一列】
 * 「模糊」两边都不计数（它既不增加 correct_count 也不增加 wrong_count），
 * 所以 `3 + 答对次数 - 答错次数` 正好等价于「认识 +1 / 不认识 -1 / 模糊不动」。
 * 这两个计数数据库里本来就有，所以**不需要改表结构、也不用迁移历史数据**。
 *
 * @param correctCount 累计答对次数（只统计「认识」）
 * @param wrongCount 累计答错次数（只统计「不认识」）
 */
export function calculateStars(
  correctCount: number,
  wrongCount: number,
): number {
  const raw = INITIAL_STARS + correctCount - wrongCount;
  return Math.min(MAX_STARS, Math.max(MIN_STARS, raw));
}

/** 从一条进度记录上算出星级，省得每次都写两个字段 */
export function starsOf(progress: {
  correct_count: number;
  wrong_count: number;
}): number {
  return calculateStars(progress.correct_count, progress.wrong_count);
}

/**
 * 「刚刚答过」的保护期（分钟）。
 *
 * ══════════════════════════════════════════════════════════════
 * 【为什么需要它 —— 来自用户的反馈】
 * 「我背单词退出去一下再回来就不是原来那个单词了，这样不好」
 *
 * 原因：队列每次打开都重新算，而你答过的词下次复习时间只排在
 * 1~5 分钟后（艾宾浩斯前三档）。所以过几分钟再进来时，
 * 它们已经「到期」了，于是排到队首 ——
 * 你就会被迫把刚背过的词再背一遍，
 * 而真正想继续的那个新词还排在后面。
 *
 * 背了 20 个新词再退出去，回来就要重背 20 个，非常劝退。
 *
 * 【为什么是 30 分钟】
 * 「退出去一下」通常是几分钟到十几分钟。30 分钟覆盖得住，
 * 又不会长到把「下次复习」整体推迟。
 *
 * 【它不影响当轮内的重新排队】
 * 当轮重排是前端做的（见 shouldRequeueInSession），短间隔的词
 * 照样会在**本次学习里**再考你一次 —— 那是设计好的。
 * 这里只是保证「退出再进来」不会把你打回原处。
 * ══════════════════════════════════════════════════════════════
 */
export const RECENT_ANSWER_GRACE_MINUTES = 30;

/**
 * 算出「刚刚答过」的时间界线：
 * 在这个时刻之后被答过的词，暂时不进服务端队列。
 */
export function recentAnswerCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RECENT_ANSWER_GRACE_MINUTES * MINUTE_MS);
}

/**
 * 连击到几次算「连续两次满星」。
 *
 * 推一遍就清楚了（新词 3 颗星起步）：
 *   答对 1 次 → 4 颗，连击 1
 *   答对 2 次 → 5 颗，连击 2   ← 第一次满星
 *   答对 3 次 → 5 颗，连击 3   ← 第二次满星，从此进入「暂时不考」
 * 所以门槛是连击 3 次。
 */
export const MASTERED_QUIET_STREAK = 3;

/**
 * 进入「暂时不考」之后，要冷多久。
 *
 * 这个数字是在两种需求之间取的折中：
 *   - 太短（比如 1 天）→ 等于没生效，满星的词还是天天冒出来
 *   - 太长（比如 180 天）→ 接近「永久不看」，而记忆会退化，
 *     一个词半年不碰很可能已经忘了，等于白背
 * 14 天（两周）：不烦你，但也不会让它彻底失联。
 */
export const MASTERED_COOLDOWN_DAYS = 14;

const COOLDOWN_MS = MASTERED_COOLDOWN_DAYS * DAY_MS;

/**
 * 这个词现在是不是该「暂时不考」？
 *
 * 三个条件同时满足才是：
 *   1. 星级已经到顶（5 颗）
 *   2. 连击 ≥ 3（也就是「连续两次满星」）
 *   3. 距离它该复习的时间还没超过冷却期
 *
 * 【为什么第 3 条必须有 —— 这是这个功能唯一的风险点】
 * 如果只看前两条，这个词就永远不出现了。而它不出现，你就永远不会答错，
 * 星级就永远不会掉，条件就永远成立 —— 变成一个单向门：
 * 词从复习队列里彻底消失，然后慢慢忘光。
 * 冷却期就是给这扇门装个自动回弹：逾期够久，它自己会回来。
 */
export function isTemporarilyQuiet(
  progress: {
    correct_count: number;
    wrong_count: number;
    consecutive_correct: number;
    next_review_time: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (starsOf(progress) < MAX_STARS) return false;
  if (progress.consecutive_correct < MASTERED_QUIET_STREAK) return false;
  if (progress.next_review_time === null) return false;

  const overdueMs =
    now.getTime() - new Date(progress.next_review_time).getTime();
  return overdueMs < COOLDOWN_MS;
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
    /*
     * 完全不会：连击归零，AGAIN_INTERVAL_MINUTES（= 1）分钟后马上再来一次。
     *
     * 这里注释以前错写成「5 分钟后」，和常量对不上 ——
     * 已按实际常量更正。改的是注释，不是代码。
     */
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
