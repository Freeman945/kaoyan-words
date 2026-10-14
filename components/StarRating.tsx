import { MAX_STARS } from "@/lib/spaced-repetition";

type StarRatingProps = {
  /** 0 ~ 5 颗星 */
  stars: number;
  /** 是否在星星后面补一个「4/5」的数字 */
  showNumber?: boolean;
  size?: "sm" | "md";
};

/**
 * 星级熟练度显示：★★★☆☆
 *
 * 规则（见 lib/spaced-repetition.ts 的 calculateStars）：
 *   新词 3 颗 · 认识 +1 · 不认识 -1 · 模糊不动 · 范围 0~5
 *
 * 用 role="img" + aria-label 是因为读屏软件念一串 ★ 毫无意义，
 * 应该直接念「熟练度 4 颗星，共 5 颗」。
 */
export function StarRating({
  stars,
  showNumber = false,
  size = "sm",
}: StarRatingProps) {
  // 就算传进来越界的数字也不会画出 7 颗星
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));

  return (
    <span
      role="img"
      aria-label={`熟练度 ${filled} 颗星，共 ${MAX_STARS} 颗`}
      title={`熟练度 ${filled} / ${MAX_STARS}`}
      className="inline-flex items-center gap-0.5"
    >
      {Array.from({ length: MAX_STARS }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={
            (size === "md" ? "text-base" : "text-sm") +
            " leading-none " +
            (index < filled ? "text-amber-500" : "text-zinc-300")
          }
        >
          ★
        </span>
      ))}

      {showNumber && (
        <span className="ml-1 text-xs tabular-nums text-zinc-400">
          {filled}/{MAX_STARS}
        </span>
      )}
    </span>
  );
}
