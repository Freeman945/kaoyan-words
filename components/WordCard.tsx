"use client";

/**
 * 单词卡：显示一个单词。
 *
 * 这个组件只负责「长什么样」，不关心数据从哪来、点了按钮之后写哪个数据库。
 * 这种「只负责显示」的组件叫展示型组件（presentational component）。
 * 好处是它可以在预览页面用，也可以在正式的背单词页面用，完全不用改。
 */
import type { Word } from "@/types";

type WordCardProps = {
  word: Word;
  /** 释义是否已经显示出来 */
  revealed: boolean;
  /** 点击「显示释义」时调用 */
  onReveal: () => void;
};

export function WordCard({ word, revealed, onReveal }: WordCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      {/* ---- 上半部分：单词本身。不管有没有显示释义都看得见 ---- */}
      <div className="text-center">
        <h2 className="break-words text-4xl font-bold tracking-tight text-slate-900">
          {word.word}
        </h2>

        {word.phonetic !== null && word.phonetic !== "" && (
          <p className="mt-3 font-mono text-sm text-slate-500">
            {word.phonetic}
          </p>
        )}

        {word.part_of_speech !== null && word.part_of_speech !== "" && (
          <p className="mt-1 text-xs text-slate-400">{word.part_of_speech}</p>
        )}
      </div>

      {/* ---- 下半部分：释义和例句，点了「显示释义」才出现 ---- */}
      {revealed ? (
        <div className="mt-8 space-y-4 border-t border-slate-100 pt-6">
          <p className="text-xl font-medium text-slate-900">{word.meaning}</p>

          {word.example !== null && word.example !== "" && (
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="leading-relaxed text-slate-800">{word.example}</p>
              {word.example_translation !== null &&
                word.example_translation !== "" && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">
                    {word.example_translation}
                  </p>
                )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8 border-t border-slate-100 pt-6">
          <button
            type="button"
            onClick={onReveal}
            className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            显示释义
            <span className="ml-2 text-xs text-slate-400">（空格键）</span>
          </button>
        </div>
      )}
    </div>
  );
}
