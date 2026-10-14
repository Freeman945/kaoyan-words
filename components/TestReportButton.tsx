"use client";

import { useState } from "react";
import { sendTestWeeklyReport } from "@/app/weekly-report-actions";

/**
 * 「立即发一封测试周报」按钮。
 *
 * 这是客户端组件（"use client"），因为它需要处理点击和显示"发送中…"。
 * 真正的发送动作在服务器上执行（Server Action），密钥不会来到浏览器。
 */
export function TestReportButton() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleClick() {
    setSending(true);
    setMessage(null);

    try {
      const result = await sendTestWeeklyReport();

      setIsError(!result.ok);
      setMessage(
        result.ok
          ? `已发送到 ${result.to}，去邮箱看看（找不到就翻一下垃圾邮件）。`
          : result.error,
      );
    } catch (cause) {
      setIsError(true);
      setMessage(cause instanceof Error ? cause.message : "发送失败。");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={sending}
        className={
          "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 " +
          "transition hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {sending ? "发送中…" : "立即发一封测试周报"}
      </button>

      {message !== null && (
        <p
          role="status"
          className={
            "text-xs leading-5 " + (isError ? "text-rose-700" : "text-emerald-700")
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
