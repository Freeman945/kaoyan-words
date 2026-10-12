"use server";

/**
 * 背单词页面用到的服务端动作。
 *
 * 页面上的三个按钮最终会走到这里，把作答结果写进数据库。
 */
import { revalidatePath } from "next/cache";
import { saveReview } from "@/lib/progress";
import type { ReviewRating, SaveReviewResult } from "@/types";

const VALID_RATINGS: readonly ReviewRating[] = ["again", "hard", "good"];

/**
 * 保存一次作答。
 *
 * 【为什么要在服务器端再校验一遍参数】
 * Server Action 本质上是一个「公开的网络接口」。虽然界面上只有三个按钮，
 * 但任何人都可以用工具直接向它发请求，传任意参数进来。
 * 所以「浏览器只会传合法值」不能当作前提 —— 每个入口都必须自己检查。
 *
 * 这也正是 Next.js 官方文档强调的：Server Action 不能用 proxy 的
 * 拦截来代替鉴权，必须自己再确认一次身份（saveReview 内部会做）。
 */
export async function submitReview(
  wordId: number,
  rating: ReviewRating,
): Promise<SaveReviewResult> {
  if (!Number.isInteger(wordId) || wordId <= 0) {
    return { ok: false, error: "单词编号不合法。" };
  }
  if (!VALID_RATINGS.includes(rating)) {
    return { ok: false, error: "作答类型不合法。" };
  }

  try {
    await saveReview(wordId, rating);

    // 首页的统计数字变了，让它下次访问时重新渲染，别显示旧数据
    revalidatePath("/");

    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "保存失败，请重试。",
    };
  }
}
