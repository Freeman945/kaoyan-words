/**
 * 晚间学习提醒。
 *
 * 【和周末周报的区别，以及为什么这个必须用定时任务】
 * 周报可以等你下次打开网站时补发 —— 晚几天看到也没关系。
 * 但「晚上 10 点还没开始学就提醒你」，如果你没打开网站，
 * 那恰恰是最需要提醒的时候。所以它必须由定时任务主动发出。
 *
 * 定时任务没有用户登录态，按 RLS 读不到数据，因此这个功能
 * 用了 Supabase 的 secret key（只存在 Vercel 服务器端，不进浏览器）。
 *
 * 这个文件只管「发不发」和「写什么」，都是纯函数，能测试。
 * 实际发送的编排在 app/api/cron/study-reminder/route.ts。
 */
import { DEFAULT_TIME_ZONE } from "./stats";

/** 默认提醒时间：晚上 10 点 */
export const REMINDER_HOUR = 22;

/**
 * 现在该不该发提醒？
 *
 * 三个条件同时满足才发：
 *   1. 今天还没发过（防止定时任务重试时发两封）
 *   2. 今天一次都没作答 —— 只要开始背了就不打扰
 *   3. 已经到提醒时间（防止手动调用把邮件提前发出去）
 */
export function shouldSendStudyReminder(params: {
  now: Date;
  /** 今天已作答次数 */
  reviewedToday: number;
  /** 今天是不是已经发过提醒了 */
  alreadySentToday: boolean;
  timeZone?: string;
  reminderHour?: number;
}): boolean {
  const {
    now,
    reviewedToday,
    alreadySentToday,
    timeZone = DEFAULT_TIME_ZONE,
    reminderHour = REMINDER_HOUR,
  } = params;

  if (alreadySentToday) return false;

  // 只要今天动过一次，就不该再提醒 —— 这个功能是「没开始」提醒，
  // 不是「没背够」提醒。
  if (reviewedToday > 0) return false;

  const hour = localHour(now, timeZone);
  return hour >= reminderHour;
}

/** 取指定时区下的整点小时数（0~23） */
export function localHour(date: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(text);
}

/**
 * 写提醒邮件。
 *
 * 语气刻意保持「陈述」而不是「催促」：报三个数字 + 一个链接就完了。
 * 不写「坚持就是胜利」这类话 —— 提醒的用处是让你知道「今天还没动」，
 * 不是说教。
 */
export function buildStudyReminderEmail(params: {
  dueForReview: number;
  dailyNewWords: number;
  streakDays: number;
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const { dueForReview, dailyNewWords, streakDays, appUrl } = params;

  const lines: string[] = [];
  lines.push("今天还没开始。");
  lines.push("");
  lines.push(`待复习  ${dueForReview}`);
  lines.push(`新词    ${dailyNewWords}`);

  // 连续记录只在确实存在时才提。0 天的时候提它没有意义。
  if (streakDays > 0) {
    lines.push(`连续学习 ${streakDays} 天`);
  }

  lines.push("");
  lines.push(appUrl);

  const text = lines.join("\n");

  const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#fafafa;font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;color:#18181b;">
  <div style="max-width:420px;">
    <p style="font-size:15px;margin:0 0 16px;">今天还没开始。</p>
    <table style="border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums;">
      <tr><td style="padding:2px 16px 2px 0;color:#71717a;">待复习</td><td>${dueForReview}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#71717a;">新词</td><td>${dailyNewWords}</td></tr>
      ${
        streakDays > 0
          ? `<tr><td style="padding:2px 16px 2px 0;color:#71717a;">连续学习</td><td>${streakDays} 天</td></tr>`
          : ""
      }
    </table>
    <p style="margin:20px 0 0;font-size:14px;">
      <a href="${appUrl}" style="color:#18181b;">${appUrl}</a>
    </p>
  </div>
</body>
</html>`;

  return { subject: "今天还没背单词", text, html };
}
