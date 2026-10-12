"use client";

/**
 * 单词卡：显示一个单词。
 *
 * 这个组件只负责「长什么样」，不关心数据从哪来、点了按钮之后写哪个数据库。
 * 这种「只负责显示」的组件叫展示型组件（presentational component）。
 * 好处是它可以在预览页面用，也可以在正式的背单词页面用，完全不用改。
 *
 * 排版上的一切都为「长时间盯着看不累」服务：
 * 单词够大、释义和例句行距放松、一眼能分清哪部分是问题、哪部分是答案。
 */
import type { Word } from "@/types";

type WordCardProps = {
  word: Word;
  /** 释义是否已经显示出来 */
  revealed: boolean;
  /** 点击「显示释义」时调用 */
  onReveal: () => void;
  /**
   * 这是本轮的新词还是复习词。
   * 不传就不显示角标（预览页面用得上）。
   */
  isNew?: boolean;
};

export function WordCard({ word, revealed, onReveal, isNew }: WordCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      {/* ---- 顶部角标：新词 / 复习 ---- */}
      {isNew !== undefined && (
        <div className="mb-5 flex justify-center">
          <span
            className={
              "rounded-full px-3 py-1 text-xs font-medium " +
              (isNew
                ? "bg-sky-100 text-sky-800"
                : "bg-amber-100 text-amber-800")
            }
          >
            {isNew ? "新词" : "复习"}
          </span>
        </div>
      )}

      {/* ---- 上半部分：单词本身。不管有没有显示释义都看得见 ---- */}
      <div className="text-center">
        <h2 className="break-words text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          {word.word}
        </h2>

        {word.phonetic !== null && word.phonetic !== "" && (
          <p className="mt-3 font-mono text-sm text-slate-500 sm:text-base">
            {word.phonetic}
          </p>
        )}

        {word.part_of_speech !== null && word.part_of_speech !== "" && (
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            {word.part_of_speech}
          </p>
        )}
      </div>

      {/* ---- 下半部分：释义和例句，点了「显示释义」才出现 ---- */}
      {revealed ? (
        <div className="mt-7 space-y-5 border-t border-slate-100 pt-6">
          <p className="text-xl font-medium text-slate-900 sm:text-2xl">
            {word.meaning}
          </p>

          {word.example !== null && word.example !== "" && (
            <div className="rounded-lg bg-slate-50 p-4">
              {/* leading-7 让英文例句的行距松开，长句子更好读 */}
              <p className="text-[15px] leading-7 text-slate-800">
                {word.example}
              </p>
              {word.example_translation !== null &&
                word.example_translation !== "" && (
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {word.example_translation}
                  </p>
                )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-7 border-t border-slate-100 pt-6">
          <button
            type="button"
            onClick={onReveal}
            className={
              "w-full rounded-lg border border-slate-300 bg-white py-3.5 text-sm font-medium " +
              "text-slate-700 transition hover:bg-slate-50 " +
              "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
            }
          >
            显示释义
            {/* 手机上不需要这个提示 */}
            <span aria-hidden="true" className="ml-2 hidden text-xs text-slate-400 sm:inline">
              （空格键）
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
