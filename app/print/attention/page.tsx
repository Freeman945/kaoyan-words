import type { Metadata } from "next";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { SetupNotice } from "@/components/SetupNotice";
import {
  clampExportDays,
  EXPORT_RANGE_OPTIONS,
  formatCsvTime,
} from "@/lib/attention-export";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getAttentionWords } from "@/lib/progress";
import { MAX_STARS } from "@/lib/spaced-repetition";

export const metadata: Metadata = {
  title: "打印单词表",
};

export const dynamic = "force-dynamic";

type PrintPageProps = {
  /** Next.js 16 里 searchParams 是 Promise，必须 await */
  searchParams: Promise<{ days?: string }>;
};

/**
 * 打印用的「需要重点关注的单词」表。
 *
 * 【为什么另做一个页面，而不是导出 CSV】
 * CSV 是给 Excel 的。想打印成纸质单词表，用 CSV 要经过
 * 「下载 → 打开 Excel → 调列宽 → 打印预览」——手机上几乎走不通。
 *
 * 这个页面直接就是排版好的表：浏览器打开 → 点「打印」→ 出纸。
 * 想存成 PDF 就在打印对话框里选「另存为 PDF」。
 *
 * 【排序】熟练度从低到高（星级升序，同星级时答得多的在前），
 * 所以打印出来的第一页就是最该看的那些词。
 */
export default async function PrintAttentionPage({
  searchParams,
}: PrintPageProps) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const user = await requireUser();
  const params = await searchParams;
  const days = clampExportDays(Number(params.days ?? "7"));

  let rows: Awaited<ReturnType<typeof getAttentionWords>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getAttentionWords(user.id, days);
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : "读取失败。";
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 print:max-w-none print:px-0 print:py-0">
      {/*
        屏幕上才显示的操作区。
        print:hidden 让它在打印时完全消失 —— 纸上不该出现按钮和返回链接。
      */}
      <div className="print:hidden">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-900"
          >
            ← 返回
          </Link>
          <PrintButton />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">时间范围</span>
          {EXPORT_RANGE_OPTIONS.map((option) => (
            <Link
              key={option.days}
              href={`/print/attention?days=${option.days}`}
              className={
                "rounded-md border px-2.5 py-1 text-xs transition-colors " +
                (option.days === days
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")
              }
            >
              {option.days} 天
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
          <a
            href={`/api/export/attention?days=${days}`}
            className="transition-colors hover:text-zinc-900"
          >
            下载 CSV（给 Excel 用）
          </a>
          <span>判定：连续 3 次没答好，或 5 次低于 4 星</span>
        </div>
      </div>

      {errorMessage !== null ? (
        <div className="mt-8 border-l-2 border-rose-400 bg-rose-50/60 py-3 pl-4 text-sm">
          <p className="font-medium text-rose-900">读取失败</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800">
            {errorMessage}
          </pre>
        </div>
      ) : (
        /*
          以下是真正会被打印出来的内容。
          打印时用 print: 前缀覆盖字号和边距，让纸质版更紧凑、更省纸。
        */
        <article className="mt-8 print:mt-0">
          <header className="border-b border-zinc-300 pb-3">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 print:text-xl">
              需重点关注的单词
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              最近 {days} 天 · 共 {rows.length} 个 · 按熟练度从低到高
            </p>
          </header>

          {rows.length === 0 ? (
            <p className="mt-8 text-sm text-zinc-500">
              这段时间里没有需要重点关注的单词。
            </p>
          ) : (
            <table className="mt-4 w-full border-collapse text-sm">
              {/* thead 在跨页时浏览器会自动重复表头，不用额外处理 */}
              <thead>
                <tr className="border-b border-zinc-300 text-left text-xs text-zinc-500">
                  <th className="w-8 py-2 text-right font-normal">#</th>
                  <th className="py-2 pl-3 font-normal">单词</th>
                  <th className="py-2 pl-3 font-normal">音标</th>
                  <th className="py-2 pl-3 font-normal">释义</th>
                  <th className="w-24 py-2 pl-3 text-center font-normal">熟练度</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.word}
                    // 一行不允许被拆到两页上
                    className="break-inside-avoid border-b border-zinc-100"
                  >
                    <td className="py-2 text-right text-xs text-zinc-400">
                      {index + 1}
                    </td>
                    <td className="py-2 pl-3 font-medium text-zinc-900">
                      {row.word}
                    </td>
                    <td className="py-2 pl-3 font-mono text-xs text-zinc-500">
                      {row.phonetic ?? ""}
                    </td>
                    <td className="py-2 pl-3 text-zinc-800">{row.meaning}</td>
                    <td className="py-2 pl-3 text-center whitespace-nowrap text-amber-600">
                      {"★".repeat(row.stars)}
                      <span className="text-zinc-300">
                        {"★".repeat(MAX_STARS - row.stars)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <footer className="mt-6 text-xs text-zinc-400 print:mt-4">
            生成于 {formatCsvTime(new Date().toISOString())} · 考研词记
          </footer>
        </article>
      )}
    </main>
  );
}
