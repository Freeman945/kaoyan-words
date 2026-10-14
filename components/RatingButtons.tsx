"use client";

/**
 * 三个作答按钮：不认识 / 模糊 / 认识。
 *
 * 按钮下面那行小字（例如「4 天后」）不是写死的，是调用方用真实的复习算法
 * 算出来后传进来的 —— 点之前就知道「点下去会怎样」。
 *
 * 键盘数字缩在按钮右上角，只写「1 / 2 / 3」。
 * 不写「按 1」这类说明：能看见数字的人自然知道，看不见的人也不受影响。
 */
import type { ReviewRating } from "@/types";

type RatingButtonsProps = {
  onRate: (rating: ReviewRating) => void;
  /** 正在保存时禁用，防止连点导致同一个词被记两次 */
  disabled?: boolean;
  /** 每个按钮下方的小字，由调用方算好传入 */
  hints?: Partial<Record<ReviewRating, string>>;
};

/** 顺序和配色。红 = 不会，橙 = 模糊，绿 = 认识，都用低饱和色 */
const BUTTONS: ReadonlyArray<{
  rating: ReviewRating;
  label: string;
  key: string;
  className: string;
}> = [
  {
    rating: "again",
    label: "不认识",
    key: "1",
    className:
      "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100 focus-visible:outline-rose-400",
  },
  {
    rating: "hard",
    label: "模糊",
    key: "2",
    className:
      "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 focus-visible:outline-amber-400",
  },
  {
    rating: "good",
    label: "认识",
    key: "3",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 focus-visible:outline-emerald-400",
  },
];

export function RatingButtons({
  onRate,
  disabled = false,
  hints = {},
}: RatingButtonsProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {BUTTONS.map((button) => (
        <button
          key={button.rating}
          type="button"
          disabled={disabled}
          onClick={() => onRate(button.rating)}
          className={
            // 手机上按钮高一点，方便拇指点
            "relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-3 " +
            "text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "disabled:cursor-not-allowed disabled:opacity-50 " +
            button.className
          }
        >
          <span>{button.label}</span>

          {hints[button.rating] !== undefined && (
            <span className="text-xs font-normal tabular-nums opacity-60">
              {hints[button.rating]}
            </span>
          )}

          {/* 键盘数字。手机上不显示——那个空间留给正事 */}
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-2 hidden text-[10px] tabular-nums opacity-40 sm:block"
          >
            {button.key}
          </span>
        </button>
      ))}
    </div>
  );
}
