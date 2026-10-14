"use server";

/**
 * 「立即发一封测试周报」。
 *
 * 为什么需要它：
 * 真正的周报只在周末发。如果配好邮件服务后要等到周六才知道有没有配错，
 * 那出了问题也没机会及时改。这个动作让你随时能验证整条链路。
 *
 * 它不会写 weekly_report_log，所以不会占掉这一周的名额 ——
 * 周末该发的那封照发不误。
 */
import { requireUser } from "@/lib/auth";
import { sendWeeklyReportNow } from "@/lib/weekly-report-send";

export type TestReportResult =
  | { ok: true; to: string; subject: string }
  | { ok: false; error: string };

export async function sendTestWeeklyReport(): Promise<TestReportResult> {
  // 没登录会直接跳转到登录页
  const user = await requireUser();

  if (user.email === undefined || user.email === "") {
    return { ok: false, error: "你的账号没有邮箱地址，发不了。" };
  }

  try {
    const result = await sendWeeklyReportNow({
      userId: user.id,
      email: user.email,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return { ok: true, to: user.email, subject: result.subject };
  } catch (cause) {
    // 比如表还没建、数据库连不上 —— 原样把原因带回去，别让用户对着
    // 一句「服务器错误」发呆
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "发送时出现未知错误。",
    };
  }
}
