"use client";

/**
 * 单词卡：显示一个单词。
 *
 * 这个组件只负责「长什么样」，不关心数据从哪来、点了按钮之后写哪个数据库。
 * 这种「只负责显示」的组件叫展示型组件，预览页和正式页可以共用。
 *
 * 排版一切都为「连续盯 30 分钟不累」服务：
 * 单词够大、释义和例句行距放开、问题区和答案区用一条线分开。
 * 不加阴影、不用大圆角 —— 长时间看着，安静的边框比立体的卡片舒服。
 */
import type { Word } from "@/types";

type WordCardProps = {
  word: Word;
  /** 释义是否已经显示出来 */
  revealed: boolean;
  /** 点击「显示释义」时调用 */
  onReveal: () => void;
  /** 本轮是新词还是复习词。不传就不显示（预览页用得上） */
  isNew?: boolean;
};

export function WordCard({ word, revealed, onReveal, isNew }: WordCardProps) {
  const phonetic = word.phonetic ?? "";
  const partOfSpeech = word.part_of_speech ?? "";
  const hasMeta = phonetic !== "" || partOfSpeech !== "";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 sm:px-10 sm:py-16">
      {isNew !== undefined && (
        <p className="mb-7 text-center text-xs tracking-wide text-zinc-400">
          {isNew ? "新词" : "复习"}
        </p>
      )}

      <div className="text-center">
        <h2 className="text-[2rem] leading-tight font-semibold tracking-tight break-words text-zinc-900 sm:text-[2.5rem]">
          {word.word}
        </h2>

        {hasMeta && (
          <p className="mt-3 font-mono text-sm text-zinc-400">
            {[phonetic, partOfSpeech].filter((part) => part !== "").join("  ")}
          </p>
        )}
      </div>

      {revealed ? (
        <div className="mt-12 border-t border-zinc-100 pt-8">
          <p className="text-xl leading-relaxed font-medium text-zinc-900 sm:text-2xl">
            {word.meaning}
          </p>

          {word.example !== null && word.example !== "" && (
            // 用左边一条线代替灰色底块：更安静，也不和按钮抢注意力
            <div className="mt-6 border-l-2 border-zinc-200 pl-4">
              <p className="text-[15px] leading-7 text-zinc-700">
                {word.example}
              </p>
              {word.example_translation !== null &&
                word.example_translation !== "" && (
                  <p className="mt-1.5 text-sm leading-6 text-zinc-500">
                    {word.example_translation}
                  </p>
                )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-12 border-t border-zinc-100 pt-8">
          <button
            type="button"
            onClick={onReveal}
            className={
              "flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 py-3.5 " +
              "text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            }
          >
            显示释义
            {/* 手机上不显示空格提示 */}
            <span
              aria-hidden="true"
              className="hidden text-xs text-zinc-400 sm:inline"
            >
              空格
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
