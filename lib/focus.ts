/**
 * 重点词判定。
 *
 * 【这个文件解决什么问题】
 * 艾宾浩斯阶梯只回答「这个词什么时候该复习」，回答不了
 * 「我现在最该盯哪几个词」。
 *
 * 两者不一样：一个到期的词你可能已经背得很熟（只是刚好到期），
 * 而一个还没到期、但你连着错了三次的词，才是真正的隐患。
 *
 * 所以这里单独做一件事：把「需要重点关注」的词挑出来并排序，
 * 并且**说清楚每个词为什么被挑中** —— 不然用户看到一列词也不知道该干嘛。
 *
 * 它是纯函数：不碰数据库、不看系统时间（now 由调用方传入），
 * 所以能用固定的数据反复测试「排序规则有没有被我改坏」。
 */
import type { Word, WordProgressRow } from "@/types";

/** 判定重点词需要的字段（只需要一部分，测试时造数据更省事） */
export type FocusCandidate = {
  word: Pick<Word, "id" | "word" | "meaning" | "phonetic" | "part_of_speech">;
  progress: Pick<
    WordProgressRow,
    | "familiarity"
    | "consecutive_correct"
    | "review_count"
    | "correct_count"
    | "wrong_count"
    | "next_review_time"
  >;
};

export type FocusWord = FocusCandidate & {
  /** 排序分数，越大越该优先看 */
  score: number;
  /** 给用户看的原因，例如「还没记住」「错误率 60%」「已逾期 3 天」 */
  reasons: string[];
  /** 逾期了几天（没逾期是 0） */
  overdueDays: number;
  /** 错误率 0~1 */
  wrongRate: number;
};

/** 分数低于这个值就不算「重点词」——避免把已经背熟的词也列进来 */
export const FOCUS_SCORE_THRESHOLD = 10;

const MS_PER_DAY = 86_400_000;

/** 掌握程度对应的基础分：越不熟分越高 */
const FAMILIARITY_SCORE: Record<number, number> = {
  0: 50, // 不认识
  1: 30, // 模糊
  2: 8, // 认识但还没到已掌握
  3: 0, // 已掌握
};

/**
 * 把一批词按「需要关注的程度」排序，返回最该看的那些。
 *
 * @param candidates 候选词（通常是自己学过的全部词）
 * @param now 当前时间，由调用方传入
 * @param limit 最多返回多少个
 */
export function rankFocusWords(
  candidates: FocusCandidate[],
  now: Date,
  limit = 20,
): FocusWord[] {
  const scored: FocusWord[] = candidates.map((candidate) => {
    const { progress } = candidate;
    const reasons: string[] = [];
    let score = 0;

    // ── 1. 掌握程度：最直接的信号 ──
    const familiarityScore = FAMILIARITY_SCORE[progress.familiarity] ?? 0;
    score += familiarityScore;
    if (progress.familiarity === 0) reasons.push("还没记住");
    else if (progress.familiarity === 1) reasons.push("总是模糊");

    // ── 2. 错误率：错得多的词最危险 ──
    const reviewCount = Math.max(0, progress.review_count);
    const wrongRate = reviewCount === 0 ? 0 : progress.wrong_count / reviewCount;
    if (reviewCount >= 2) {
      // 最多加 25 分，避免一个错了很多次的词把其他维度完全盖住
      score += Math.round(wrongRate * 25);
      if (wrongRate >= 0.5) {
        reasons.push(`错误率 ${Math.round(wrongRate * 100)}%`);
      }
    }

    // ── 3. 累计答错次数：哪怕错误率不高，老是错也说明这个字有坑 ──
    const wrongPenalty = Math.min(20, progress.wrong_count * 4);
    score += wrongPenalty;
    if (progress.wrong_count >= 3) {
      reasons.push(`累计答错 ${progress.wrong_count} 次`);
    }

    // ── 4. 逾期：到点了却一直没复习，遗忘只会更严重 ──
    let overdueDays = 0;
    if (progress.next_review_time) {
      const overdueMs =
        now.getTime() - new Date(progress.next_review_time).getTime();
      if (overdueMs > 0) {
        overdueDays = Math.floor(overdueMs / MS_PER_DAY);
      }
    }
    if (overdueDays >= 1) {
      score += Math.min(30, overdueDays * 2);
      reasons.push(`已逾期 ${overdueDays} 天`);
    }

    // ── 5. 最近一次答错（连击为 0 且背过）：优先补一下 ──
    if (reviewCount > 0 && progress.consecutive_correct === 0) {
      score += 10;
      if (!reasons.includes("还没记住") && !reasons.includes("总是模糊")) {
        reasons.push("最近一次没答对");
      }
    }

    // 一个原因都没有的时候给个兜底说明，界面上不至于空着
    if (reasons.length === 0) reasons.push("需要巩固");

    return { ...candidate, score, reasons, overdueDays, wrongRate };
  });

  return scored
    .filter((item) => item.score >= FOCUS_SCORE_THRESHOLD)
    .sort((a, b) => {
      // 先按分数；分数相同时，逾期久的排前面，再相同就按词序（保证结果稳定）
      if (b.score !== a.score) return b.score - a.score;
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
      return a.word.word.localeCompare(b.word.word);
    })
    .slice(0, limit);
}
