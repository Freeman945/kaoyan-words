/**
 * 学习统计。
 *
 * 这个文件负责把数据库里读出来的原始记录，算成 Dashboard 上显示的那些数字：
 * 「已掌握多少词」「今天学了多少」「连续学了几天」。
 *
 * 【为什么单独抽成纯函数】
 * 统计最容易出错的不是查询，而是「算」。比如「今天」到底指哪一天？
 * 把它写成不碰数据库的纯函数，就能用固定的时间点反复测试，
 * 而不是等到半夜发现数字跳变才怀疑代码。
 *
 * 【一个很容易踩的坑：时区】
 * 服务器（包括 Vercel）默认跑在 UTC 时间。而你在北京（UTC+8）。
 * 如果直接用服务器时间判断「今天」，那么北京时间每天 08:00 之前，
 * 服务器那边还算「昨天」—— 你早上背的单词会显示成昨天学的。
 * 所以下面所有按「天」分组的计算，都必须显式指定时区。
 */
import type { Familiarity } from "@/types";
import { isDue } from "./spaced-repetition";

/** 默认时区。个人自用固定成北京时间即可；以后要多时区再改成从用户设置读取。 */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

/** 一天的毫秒数 */
const MS_PER_DAY = 86_400_000;

/** 统计只需要进度记录里的这几个字段，不必传整行，测试时也好造数据 */
export type ProgressSummary = {
  word_id: number;
  familiarity: Familiarity;
  next_review_time: string | null;
};

/** 统计只需要流水记录里的这两个字段 */
export type ReviewLogSummary = {
  reviewed_at: string;
  rating: "again" | "hard" | "good";
};

/** 某一天的学习量 */
export type DailyCount = {
  /** 本地日期，格式 YYYY-MM-DD */
  date: string;
  /** 显示用短标签，例如 10/12 */
  label: string;
  count: number;
};

export type ProgressStats = {
  /** 学过多少个单词（有进度记录的词） */
  totalWords: number;
  /** 其中已掌握（familiarity = 3）的 */
  masteredWords: number;
  /** 还没掌握、正在学的 */
  learningWords: number;
  /** 现在就该复习的词数 */
  dueForReview: number;
  /** 今天作答了多少次 */
  reviewedToday: number;
  /** 最近 7 天每天的学习量，从早到晚排列 */
  last7Days: DailyCount[];
  /** 连续学习天数 */
  streakDays: number;
};

/**
 * 把某个时刻换算成「指定时区下的日期」，格式 YYYY-MM-DD。
 *
 * 用 en-CA 这个区域设置是个小技巧：它的日期格式天生就是 YYYY-MM-DD，
 * 正好方便直接当字符串比较和排序。
 */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 把 YYYY-MM-DD 转成一个「第几天」的整数，方便做加减和比较。
 *
 * 为什么绕这一圈？直接在日期上减 24 小时会遇到夏令时问题
 * （某些时区一天不是 24 小时，会导致日期跳格或重复）。
 * 转成纯数字后再加减，就不会有这个坑。
 */
function dayNumberFromKey(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / MS_PER_DAY);
}

/** 「第几天」还原成 YYYY-MM-DD */
function keyFromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * 计算连续学习天数。
 *
 * 规则（刻意做得宽容一点，避免让人焦虑）：
 *   - 今天学过 → 从今天往前数
 *   - 今天还没学 → 从昨天往前数（今天还没过完，不算断）
 *   - 昨天也没学 → 断了，返回 0
 */
export function calculateStreak(
  logs: ReviewLogSummary[],
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  if (logs.length === 0) return 0;

  const studiedDays = new Set(
    logs.map((log) => dayNumberFromKey(localDateKey(new Date(log.reviewed_at), timeZone))),
  );

  const today = dayNumberFromKey(localDateKey(now, timeZone));
  let cursor = studiedDays.has(today) ? today : today - 1;

  let streak = 0;
  while (studiedDays.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/**
 * 生成「最近 days 天」的日期键，从早到晚排列。
 *
 * 为什么统一放在这里：日期加减有夏令时的坑（某些时区一天不是 24 小时），
 * 走 dayNumberFromKey 这套「整数天」运算才稳，不允许各处自己减 86400000。
 */
export function recentDateKeys(
  now: Date,
  days: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): string[] {
  const today = dayNumberFromKey(localDateKey(now, timeZone));
  const keys: string[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(keyFromDayNumber(today - offset));
  }
  return keys;
}

/** 把 "2026-10-12" 变成显示用的 "10/12" */
function shortDateLabel(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
}

/**
 * 统计最近 7 天每天的学习量（按作答次数算）。
 * 返回 7 条，从最早到今天，方便直接画成柱状图。
 */
export function countLast7Days(
  logs: ReviewLogSummary[],
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): DailyCount[] {
  const countsByDate = new Map<string, number>();

  for (const log of logs) {
    const key = localDateKey(new Date(log.reviewed_at), timeZone);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }

  return recentDateKeys(now, 7, timeZone).map((key) => ({
    date: key,
    label: shortDateLabel(key),
    count: countsByDate.get(key) ?? 0,
  }));
}

/**
 * 汇总出 Dashboard 需要的所有数字。
 *
 * @param progress 该用户所有进度记录
 * @param logs     该用户最近的作答流水（只需要覆盖最近 7 天，能省流量）
 * @param now      当前时间，由调用方传入，方便测试
 * @param timeZone 用户所在时区
 */
export function summarizeProgress(
  progress: ProgressSummary[],
  logs: ReviewLogSummary[],
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): ProgressStats {
  const todayKey = localDateKey(now, timeZone);

  const masteredWords = progress.filter((row) => row.familiarity === 3).length;

  const dueForReview = progress.filter((row) =>
    isDue(row.next_review_time, now),
  ).length;

  const reviewedToday = logs.filter(
    (log) => localDateKey(new Date(log.reviewed_at), timeZone) === todayKey,
  ).length;

  return {
    totalWords: progress.length,
    masteredWords,
    learningWords: progress.length - masteredWords,
    dueForReview,
    reviewedToday,
    last7Days: countLast7Days(logs, now, timeZone),
    streakDays: calculateStreak(logs, now, timeZone),
  };
}

/** 每天计划学多少个新词。想调节奏就改这一个数字。 */
export const DAILY_NEW_WORD_GOAL = 20;

/**
 * 决定今天这一轮要背哪些词。
 *
 * 规则很简单：
 *   - 所有到期的复习词都要背完（复习优先于学新词）
 *   - 新词最多学 DAILY_NEW_WORD_GOAL 个，词库不够就有多少学多少
 */
export function buildDailyPlan(input: {
  dueCount: number;
  newWordsAvailable: number;
  dailyNewWordGoal?: number;
}): { reviewCount: number; newWordCount: number; total: number } {
  const goal = input.dailyNewWordGoal ?? DAILY_NEW_WORD_GOAL;
  const reviewCount = Math.max(0, input.dueCount);
  const newWordCount = Math.max(0, Math.min(input.newWordsAvailable, goal));

  return {
    reviewCount,
    newWordCount,
    total: reviewCount + newWordCount,
  };
}
