/**
 * 发邮件。
 *
 * 【为什么必须用第三方服务】
 * Vercel 和 Supabase 都发不了「自定义内容的邮件」——
 * Supabase 自带的邮件只能用来发验证码和登录链接，改不了内容。
 * 所以必须接一家邮件服务。这里用 Resend：免费额度 3000 封/月，
 * 对「每周给自己发一封」这种用量完全够。
 *
 * 【为什么密钥不放在 NEXT_PUBLIC_ 里】
 * 带 NEXT_PUBLIC_ 前缀的环境变量会被**打包进浏览器代码**，等于公开。
 * RESEND_API_KEY 没有这个前缀，所以只存在于服务器端。
 * 这个区别很关键，见 lib/env.ts 里的说明。
 *
 * 【没有配置密钥时会怎样】
 * 不会崩，只是明确告诉你「还没配置，邮件发不出去」。
 * 所以这个功能可以先合进代码、等你拿到密钥再启用。
 */

/** Resend 的发送接口 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string };

/** 邮件服务配置好了吗（界面据此决定要不要提示你去配） */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** 发件人地址。默认用 Resend 提供的测试发件人，可以换。 */
function fromAddress(): string {
  return process.env.REPORT_FROM_EMAIL ?? "背词周报 <onboarding@resend.dev>";
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error:
        "还没有配置 RESEND_API_KEY，所以邮件没有发出去。" +
        "（周报内容本身是正常的，配好密钥后就能发。）",
    };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // text 和 html 都给：有些客户端只认纯文本，反过来也一样
      body: JSON.stringify({
        from: fromAddress(),
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: `邮件服务返回 ${response.status}：${body.slice(0, 300)}`,
      };
    }

    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "发送邮件时出错。",
    };
  }
}
