/**
 * 学习节奏估算。
 *
 * 【为什么要做这个】
 * 原来首页写死「今日新词 20 个」—— 这是拍脑袋定的数字，而且有两个问题：
 *   1. 它不关心你实际背得动多少。你昨天背了 5 个就累了，今天照样让你背 20 个；
 *   2. 它不告诉你「这样下去能不能背完」。
 *
 * 现在改成：**观察你最近两周真实的学习量，用它推算你什么时候能背完**，
 * 再对照考研日期告诉你来不来得及。
 *
 * 它是纯函数：不碰数据库、不看系统时间（时间从外面传进来），
 * 所以能用固定的数据反复测试推算规则有没有被改坏。
 */
import { DEFAULT_TIME_ZONE, localDateKey } from "./stats";

/**
 * 2028 考研初试日期。
 *
 * 考研初试一般在 12 月倒数第二个周末。这个日期只是用来算「来不来得及」，
 * **想改就直接改这一行**（格式必须是 YYYY-MM-DD）。
 */
export const EXAM_DATE_ISO = "2027-12-25";

/** 估算时往前看多少天 */
export const PACE_WINDOW_DAYS = 14;

const MS_PER_DAY = 86_400_000;

export type PaceEstimate = {
  /** 实际纳入统计的天数（从你第一次学习那天算到今天，最多 14 天） */
  windowDays: number;
  /** 这期间一共新学了多少个词 */
  totalNewWords: number;
  /** 平均每天新学多少词（把休息日也算进去，这才是真实节奏） */
  avgPerDay: number;
  /** 这期间有几天真的学了 */
  activeDays: number;
  /** 按当前节奏还要多少天背完（数据不足时为 null） */
  daysToFinish: number | null;
  /** 预计背完的日期，YYYY-MM-DD（数据不足时为 null） */
  projectedFinishDate: string | null;
  /** 距离考试还有多少天 */
  daysUntilExam: number;
  /** 想在考试前背完，每天需要新学多少词 */
  requiredPerDay: number;
  /** 按现在的节奏，考试前背得完吗 */
  onTrack: boolean;
  /** 现在这个节奏，比起考试需要，是多还是少 */
  paceVerdict: "ahead" | "on-track" | "behind" | "unknown";
};

/**
 * 根据最近两周的每日新词量，推算背完时间。
 *
 * @param dailyNewWords 最近 14 天每天新学的词数，**从早到晚**排列（含没学习的天，填 0）
 * @param remainingWords 还剩多少个词完全没学过
 * @param now 当前时间
 * @param timeZone 用户所在时区（影响"哪天"的判断）
 * @param examDateIso 考试日期
 */
export function estimatePace(
  dailyNewWords: number[],
  remainingWords: number,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
  examDateIso: string = EXAM_DATE_ISO,
): PaceEstimate {
  const examDate = new Date(`${examDateIso}T00:00:00+08:00`);
  const daysUntilExam = Math.max(
    0,
    Math.floor((examDate.getTime() - now.getTime()) / MS_PER_DAY),
  );

  const remaining = Math.max(0, remainingWords);

  // ── 从「第一次开始学习」那天算起，而不是死板地用满 14 天 ──
  // 否则一个刚开始用 3 天的人，会因为前面 11 天是 0 而被算出
  // 「每天只背 4 个词」这种严重偏低的节奏。
  const firstActiveIndex = dailyNewWords.findIndex((count) => count > 0);
  const windowDays =
    firstActiveIndex === -1
      ? dailyNewWords.length
      : dailyNewWords.length - firstActiveIndex;

  const relevantDays =
    firstActiveIndex === -1 ? dailyNewWords : dailyNewWords.slice(firstActiveIndex);

  const totalNewWords = relevantDays.reduce((sum, count) => sum + count, 0);
  const activeDays = relevantDays.filter((count) => count > 0).length;
  const avgPerDay = windowDays > 0 ? totalNewWords / windowDays : 0;

  // ── 预计还要多久背完 ──
  let daysToFinish: number | null = null;
  let projectedFinishDate: string | null = null;

  if (remaining === 0) {
    // 已经背完了，不用再估
    daysToFinish = 0;
    projectedFinishDate = localDateKey(now, timeZone);
  } else if (avgPerDay > 0) {
    daysToFinish = Math.ceil(remaining / avgPerDay);
    projectedFinishDate = localDateKey(
      new Date(now.getTime() + daysToFinish * MS_PER_DAY),
      timeZone,
    );
  }

  // ── 想在考前背完，每天得背多少 ──
  const requiredPerDay =
    daysUntilExam <= 0
      ? remaining
      : Math.ceil(remaining / daysUntilExam);

  // ── 给出结论 ──
  let paceVerdict: PaceEstimate["paceVerdict"] = "unknown";
  if (remaining === 0) {
    paceVerdict = "ahead";
  } else if (daysToFinish !== null) {
    if (daysToFinish <= daysUntilExam * 0.8) paceVerdict = "ahead";
    else if (daysToFinish <= daysUntilExam) paceVerdict = "on-track";
    else paceVerdict = "behind";
  }

  return {
    windowDays,
    totalNewWords,
    avgPerDay,
    activeDays,
    daysToFinish,
    projectedFinishDate,
    daysUntilExam,
    requiredPerDay,
    onTrack: remaining === 0 || (daysToFinish !== null && daysToFinish <= daysUntilExam),
    paceVerdict,
  };
}

/**
 * 今天该安排多少个新词。
 *
 * 【和原来的区别】
 * 原来写死 20 个。现在跟着你自己的节奏走：取最近两周的平均值，
 * 并且限制在一个不离谱的区间内 ——
 * 下限 5 个（太少的话进度会停滞），上限 60 个（太多的话第二天会不想打开）。
 *
 * 如果还没有任何学习记录，返回一个保守的起步值。
 *
 * @param avgPerDay 最近两周平均每天新学的词数（来自 estimatePace）
 */
export function suggestDailyNewWordGoal(avgPerDay: number): number {
  const FLOOR = 5;
  const CEILING = 60;
  const COLD_START = 20;

  if (avgPerDay <= 0) return COLD_START;

  return Math.min(CEILING, Math.max(FLOOR, Math.round(avgPerDay)));
}
