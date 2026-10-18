/**
 * 「需要重点关注的单词」的判定 + 导出成 CSV。
 *
 * ══════════════════════════════════════════════════════════════
 * 【判定标准】（用户定的）
 *   ① 连续三次不认识 / 模糊
 *      —— 在选定时间范围内，这个词**最近 3 次**作答都是「不认识」或「模糊」
 *   ② 五次低于四星
 *      —— 在范围内，有 5 次作答之后星级不到 4 颗
 *   两条满足任意一条，就算「需要重点关注」。
 *
 * 【一个技术难点：星级怎么算回过去】
 * 星级 = 3 + 答对次数 − 答错次数（截断到 0~5），而数据库里只存**当前总计**，
 * 不存每次作答时的星级。所以：
 *   先反推窗口开始时的计数：
 *     窗口开始时的答对 = 当前答对 − 窗口内「认识」的次数
 *     窗口开始时的答错 = 当前答错 − 窗口内「不认识」的次数
 *   再从窗口开头往后重放一遍，就能得到每次作答之后的星级。
 * 这样只需要「当前总计 + 窗口内的流水」，不用把历史全部拉出来。
 *
 * 【时间范围】
 * 所有判定都只在用户选定的范围内做。一个词如果范围内只答过 2 次，
 * 就凑不满「连续三次」，自然不会进列表 —— 这是有意的：
 * 导出的应该是「最近这段时间里暴露出来的问题」。
 * ══════════════════════════════════════════════════════════════
 */
import { calculateStars, MAX_STARS } from "./spaced-repetition";
import type { ReviewRating } from "@/types";

/** 连续几次不认识/模糊算「需要关注」 */
export const CONSECUTIVE_FAILS = 3;

/** 几次低于四星算「需要关注」 */
export const LOW_STAR_TIMES = 5;

/** 「低于四星」的门槛：星级 < 4 */
export const LOW_STAR_THRESHOLD = 4;

/** 时间范围：1 天到 30 天。界面上的下拉框就用这个列表。 */
export const EXPORT_RANGE_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: "最近 1 天" },
  { days: 3, label: "最近 3 天" },
  { days: 7, label: "最近 7 天" },
  { days: 14, label: "最近 14 天" },
  { days: 30, label: "最近 30 天" },
];

export const MIN_EXPORT_DAYS = 1;
export const MAX_EXPORT_DAYS = 30;

/** 把用户传进来的天数夹到合法范围，防止用 ?days=99999 把数据库拖垮 */
export function clampExportDays(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.min(MAX_EXPORT_DAYS, Math.max(MIN_EXPORT_DAYS, Math.round(days)));
}

export type AttentionLog = {
  rating: ReviewRating;
  /** ISO 时间字符串 */
  reviewed_at: string;
};

export type AttentionInput = {
  word: {
    word: string;
    phonetic: string | null;
    meaning: string;
  };
  /** 这个词历来的总答对次数（不只窗口内） */
  correctCount: number;
  /** 这个词历来的总答错次数（不只窗口内） */
  wrongCount: number;
  /** 窗口内的作答流水，**必须按时间从早到晚排好** */
  logs: AttentionLog[];
};

export type AttentionVerdict = {
  /** 是否进了「需要重点关注」列表 */
  needsAttention: boolean;
  /** 为什么被挑中（给用户看的中文原因） */
  reasons: string[];
  /** 窗口内最后一次作答之后的星级 */
  stars: number;
  /** 窗口内作答了几次 */
  windowAttempts: number;
  /** 窗口内最后一次作答的时间 */
  lastRatedAt: string | null;
};

/** 「不认识」和「模糊」都算没答好 */
function isFailRating(rating: ReviewRating): boolean {
  return rating === "again" || rating === "hard";
}

/**
 * 判定一个词是否需要重点关注。
 *
 * 这个是纯函数：不碰数据库、不看系统时间，同样的输入永远同样的输出。
 */
export function judgeAttention(input: AttentionInput): AttentionVerdict {
  const { logs } = input;

  if (logs.length === 0) {
    return {
      needsAttention: false,
      reasons: [],
      stars: calculateStars(input.correctCount, input.wrongCount),
      windowAttempts: 0,
      lastRatedAt: null,
    };
  }

  // ---- 反推窗口开始时的答对/答错次数 ----
  const goodInWindow = logs.filter((log) => log.rating === "good").length;
  const againInWindow = logs.filter((log) => log.rating === "again").length;

  let correct = input.correctCount - goodInWindow;
  let wrong = input.wrongCount - againInWindow;

  /*
   * 防御：如果数据库里的总计比窗口内的次数还少（理论上不该发生，
   * 除非统计被别处改过），说明反推出来的起点不可信 —— 从初始状态开始。
   */
  if (correct < 0 || wrong < 0) {
    correct = 0;
    wrong = 0;
  }

  // ---- 从窗口开头往后重放，得到每次作答之后的星级 ----
  let stars = calculateStars(correct, wrong);
  const starsAfterEach: number[] = [];

  for (const log of logs) {
    if (log.rating === "good") correct += 1;
    else if (log.rating === "again") wrong += 1;
    // hard（模糊）不加不减，和 calculateStars 的语义一致
    stars = calculateStars(correct, wrong);
    starsAfterEach.push(stars);
  }

  const reasons: string[] = [];

  // ---- 标准 ①：最近连续 3 次都是不认识 / 模糊 ----
  const tail = logs.slice(-CONSECUTIVE_FAILS);
  if (
    logs.length >= CONSECUTIVE_FAILS &&
    tail.every((log) => isFailRating(log.rating))
  ) {
    reasons.push(`连续 ${CONSECUTIVE_FAILS} 次不认识/模糊`);
  }

  // ---- 标准 ②：有 5 次作答之后星级不到 4 颗 ----
  const lowStarCount = starsAfterEach.filter(
    (value) => value < LOW_STAR_THRESHOLD,
  ).length;
  if (lowStarCount >= LOW_STAR_TIMES) {
    reasons.push(
      `${lowStarCount} 次低于 ${LOW_STAR_THRESHOLD} 星（现在 ${stars} 星，共 ${MAX_STARS} 星）`,
    );
  }

  return {
    needsAttention: reasons.length > 0,
    reasons,
    stars,
    windowAttempts: logs.length,
    lastRatedAt: logs[logs.length - 1]?.reviewed_at ?? null,
  };
}

/** 导出的 CSV 用哪几列（顺序也定了） */
export const ATTENTION_CSV_HEADER = [
  "单词",
  "音标",
  "释义",
  "当前星级",
  "近期作答次数",
  "最近作答时间",
  "判定原因",
] as const;

export type AttentionExportRow = {
  word: string;
  phonetic: string | null;
  meaning: string;
  stars: number;
  windowAttempts: number;
  lastRatedAt: string | null;
  reasons: string[];
};

/** CSV 里一个字段的转义：带逗号/引号/换行的必须用双引号包起来 */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** 把 ISO 时间变成「2026-10-18 20:31」这种好读的样子（按北京时间） */
export function formatCsvTime(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * 生成 CSV 文本。
 *
 * 【为什么开头要加一个看不见的字符】
 * 那是 UTF-8 的 BOM。Excel（尤其 Windows 版）打开不带 BOM 的 UTF-8 CSV 时，
 * 中文会变成乱码。加上它，双击就能正常显示 —— 这个字符肉眼看不见。
 */
export function buildAttentionCsv(rows: AttentionExportRow[]): string {
  const lines: string[] = [ATTENTION_CSV_HEADER.join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvField(row.word),
        csvField(row.phonetic ?? ""),
        csvField(row.meaning),
        String(row.stars),
        String(row.windowAttempts),
        csvField(formatCsvTime(row.lastRatedAt)),
        csvField(row.reasons.join("；")),
      ].join(","),
    );
  }

  // \r\n 是 CSV 的标准换行，Excel 和 WPS 都认
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
