"use client";

/**
 * 三个作答按钮：不认识 / 模糊 / 认识。
 *
 * 【一个用心的小设计】
 * 每个按钮下面那行小字（例如「3 天后」）不是写死的，而是由调用方用
 * 真实的复习算法算出来后传进来的。所以你点之前就能看到「点下去会发生
 * 什么」。同一个单词在不同阶段，这三个数字是不一样的 —— 这正是
 * 间隔复习在起作用的样子。
 */
import type { ReviewRating } from "@/types";

type RatingButtonsProps = {
  onRate: (rating: ReviewRating) => void;
  /** 正在保存时禁用按钮，防止连点导致同一个词被记两次 */
  disabled?: boolean;
  /** 每个按钮下方的小字提示，由调用方算好传入 */
  hints?: Partial<Record<ReviewRating, string>>;
};

/** 按钮的顺序和配色。红色 = 不会，黄色 = 模糊，绿色 = 认识 */
const BUTTON_CONFIG: ReadonlyArray<{
  rating: ReviewRating;
  label: string;
  keyboardKey: string;
  className: string;
}> = [
  {
    rating: "again",
    label: "不认识",
    keyboardKey: "1",
    className:
      "border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100 focus-visible:ring-rose-400",
  },
  {
    rating: "hard",
    label: "模糊",
    keyboardKey: "2",
    className:
      "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 focus-visible:ring-amber-400",
  },
  {
    rating: "good",
    label: "认识",
    keyboardKey: "3",
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 focus-visible:ring-emerald-400",
  },
];

export function RatingButtons({
  onRate,
  disabled = false,
  hints = {},
}: RatingButtonsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {BUTTON_CONFIG.map((button) => (
        <button
          key={button.rating}
          type="button"
          disabled={disabled}
          onClick={() => onRate(button.rating)}
          className={
            "flex flex-col items-center gap-1 rounded-xl border px-3 py-4 text-sm font-medium " +
            "transition focus-visible:ring-2 focus-visible:outline-none " +
            "disabled:cursor-not-allowed disabled:opacity-50 " +
            button.className
          }
        >
          <span>{button.label}</span>
          {hints[button.rating] !== undefined && (
            <span className="text-xs font-normal opacity-70">
              {hints[button.rating]}
            </span>
          )}
          <span className="text-[10px] opacity-50">按 {button.keyboardKey}</span>
        </button>
      ))}
    </div>
  );
}
