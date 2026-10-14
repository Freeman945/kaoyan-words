/**
 * 背词周报的内容生成。
 *
 * 【为什么单独一个文件】
 * 「周报里写什么」和「用什么方式把邮件发出去」是两件事。
 * 这个文件只管前者：拿到一堆数字，组织成一封读得下去的周报。
 * 它是纯函数，所以能用固定数据测试 —— 不会因为邮件服务换了一家就失效。
 */
import { DEFAULT_TIME_ZONE, localDateKey } from "./stats";

export type WeeklyReportData = {
  /** 这一周的开始与结束日期（YYYY-MM-DD） */
  weekStart: string;
  weekEnd: string;
  /** 本周每天的学习量（作答次数），从周一到周日，共 7 个 */
  dailyReviewed: number[];
  /** 本周每天新学的词数，从周一到周日，共 7 个 */
  dailyNewWords: number[];
  /** 连续学习天数 */
  streakDays: number;
  /** 已经学过的词数 */
  learnedWords: number;
  /** 词库总词数 */
  totalWords: number;
  /** 已掌握的词数（按艾宾浩斯阶梯，间隔排到 15 天以上） */
  masteredWords: number;
  /** 本周最该盯的几个词 */
  weakWords: Array<{
    word: string;
    meaning: string;
    wrongCount: number;
    stars: number;
  }>;
  /** 平均每天新学多少词（最近两周） */
  avgPerDay: number;
  /** 预计背完日期，null 表示数据不足 */
  projectedFinishDate: string | null;
  /** 距离考试还有多少天 */
  daysUntilExam: number;
  /** 想在考前背完，每天需要新学多少 */
  requiredPerDay: number;
};

export type WeeklyReport = {
  subject: string;
  /** 纯文本正文 */
  text: string;
  /** HTML 正文（邮件里更好看，但纯文本才是保底的那个） */
  html: string;
};

const WEEKDAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

/** 把数字数组求和 */
function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** 用方块画一个迷你柱状图，纯文本邮件里也能看懂 */
function textBar(value: number, max: number, width = 10): string {
  if (max <= 0) return "";
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return "█".repeat(filled);
}

/**
 * 生成一封周报。
 *
 * 语气上刻意做得「像人说话」而不是「像报表」——
 * 周报是每周唯一一次和自己对话的机会，列一堆数字没人会看。
 */
export function buildWeeklyReport(data: WeeklyReportData): WeeklyReport {
  const totalReviewed = sum(data.dailyReviewed);
  const totalNewWords = sum(data.dailyNewWords);
  const activeDays = data.dailyNewWords.filter((count) => count > 0).length;
  const maxReviewed = Math.max(0, ...data.dailyReviewed);

  const subject = `背词周报 ${data.weekStart} ~ ${data.weekEnd}：本周新学 ${totalNewWords} 个词`;

  // ── 开头：一句结论 ──
  const opening =
    totalReviewed === 0
      ? "这一周没有背词记录。没关系，休息也是学习的一部分 —— 下周挑一天重新开始就行。"
      : activeDays >= 5
        ? `这一周你学了 ${activeDays} 天，很稳。`
        : `这一周你学了 ${activeDays} 天。`;

  const lines: string[] = [];
  lines.push(opening);
  lines.push("");
  lines.push(`本周作答 ${totalReviewed} 次，新学 ${totalNewWords} 个词。`);

  // ── 每天的学习量 ──
  lines.push("");
  lines.push("每天的学习量：");
  data.dailyReviewed.forEach((count, index) => {
    const name = WEEKDAY_NAMES[index] ?? "?";
    lines.push(`  周${name}  ${String(count).padStart(3, " ")}  ${textBar(count, maxReviewed)}`);
  });

  // ── 进度 ──
  lines.push("");
  lines.push(
    `总进度：已学 ${data.learnedWords} / ${data.totalWords} 个词，` +
      `其中 ${data.masteredWords} 个已掌握。`,
  );
  lines.push(`连续学习：${data.streakDays} 天。`);

  // ── 重点词 ──
  if (data.weakWords.length > 0) {
    lines.push("");
    lines.push("本周最该盯的几个词：");
    for (const item of data.weakWords) {
      lines.push(
        `  ${item.word}  ${"★".repeat(item.stars)}${"☆".repeat(5 - item.stars)}` +
          `  错 ${item.wrongCount} 次  ${item.meaning}`,
      );
    }
  }

  // ── 完成预测 ──
  lines.push("");
  if (data.projectedFinishDate !== null && data.avgPerDay > 0) {
    lines.push(
      `按最近两周的节奏（平均每天 ${data.avgPerDay.toFixed(1)} 个新词），` +
        `预计 ${data.projectedFinishDate} 背完。`,
    );

    const onTrack = data.requiredPerDay <= data.avgPerDay;
    lines.push(
      onTrack
        ? `距离考试还有 ${data.daysUntilExam} 天 —— 这个节奏来得及。`
        : `距离考试还有 ${data.daysUntilExam} 天 —— 按这个速度背不完，` +
            `需要每天新学 ${data.requiredPerDay} 个。`,
    );
  } else {
    lines.push("学习记录还太少，暂时算不出预计背完的时间。再背几天就有了。");
  }

  lines.push("");
  lines.push("—— 考研英语背单词");

  const text = lines.join("\n");

  // ── HTML 版本 ──
  // 刻意写得很朴素：邮件客户端对 CSS 的支持千奇百怪，
  // 复杂排版十有八九会在某个客户端里散架。
  const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 4px;font-size:18px;">背词周报</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:13px;">${data.weekStart} ~ ${data.weekEnd}</p>

    <p style="font-size:15px;line-height:1.7;">${opening}</p>
    <p style="font-size:15px;line-height:1.7;">
      本周作答 <strong>${totalReviewed}</strong> 次，新学 <strong>${totalNewWords}</strong> 个词。
    </p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      ${data.dailyReviewed
        .map(
          (count, index) =>
            `<tr><td style="padding:3px 8px 3px 0;color:#64748b;">周${WEEKDAY_NAMES[index] ?? "?"}</td>` +
            `<td style="padding:3px 8px 3px 0;text-align:right;">${count}</td>` +
            `<td style="padding:3px 0;color:#0f172a;">${"█".repeat(
              maxReviewed > 0 ? Math.max(count > 0 ? 1 : 0, Math.round((count / maxReviewed) * 20)) : 0,
            )}</td></tr>`,
        )
        .join("")}
    </table>

    <p style="font-size:15px;line-height:1.7;">
      总进度：已学 <strong>${data.learnedWords}</strong> / ${data.totalWords} 个词，
      其中 <strong>${data.masteredWords}</strong> 个已掌握。<br>
      连续学习：<strong>${data.streakDays}</strong> 天。
    </p>

    ${
      data.weakWords.length > 0
        ? `<h2 style="font-size:14px;margin:20px 0 8px;">本周最该盯的几个词</h2>
    <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.9;">
      ${data.weakWords
        .map(
          (item) =>
            `<li><strong>${item.word}</strong> ` +
            `<span style="color:#f59e0b;">${"★".repeat(item.stars)}${"☆".repeat(5 - item.stars)}</span> ` +
            `<span style="color:#94a3b8;">错 ${item.wrongCount} 次</span><br>` +
            `<span style="color:#475569;">${item.meaning}</span></li>`,
        )
        .join("")}
    </ul>`
        : ""
    }

    <p style="font-size:15px;line-height:1.7;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;color:#475569;">
      ${
        data.projectedFinishDate !== null && data.avgPerDay > 0
          ? `按最近两周的节奏（平均每天 ${data.avgPerDay.toFixed(1)} 个新词），` +
            `预计 <strong>${data.projectedFinishDate}</strong> 背完。<br>` +
            (data.requiredPerDay <= data.avgPerDay
              ? `距离考试还有 ${data.daysUntilExam} 天 —— 这个节奏来得及。`
              : `<span style="color:#be123c;">距离考试还有 ${data.daysUntilExam} 天 —— ` +
                `按这个速度背不完，需要每天新学 ${data.requiredPerDay} 个。</span>`)
          : "学习记录还太少，暂时算不出预计背完的时间。"
      }
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * 从「本周学习日志」里算出周报需要的数字。
 *
 * 单独抽出来是因为它也是纯计算，值得测试。
 */
export function summarizeWeek(
  reviewedTimestamps: string[],
  newWordTimestamps: string[],
  weekStart: Date,
  timeZone: string,
): { dailyReviewed: number[]; dailyNewWords: number[] } {
  // 用「距周一的第几天」作为下标，避免依赖具体日期字符串
  const dayIndexOf = (iso: string): number => {
    const date = new Date(iso);
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const startKey = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(weekStart);

    const toDayNumber = (key: string): number => {
      const [year, month, day] = key.split("-").map(Number);
      return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
    };

    return toDayNumber(dayKey) - toDayNumber(startKey);
  };

  const dailyReviewed = [0, 0, 0, 0, 0, 0, 0];
  const dailyNewWords = [0, 0, 0, 0, 0, 0, 0];

  for (const iso of reviewedTimestamps) {
    const index = dayIndexOf(iso);
    if (index >= 0 && index < 7) dailyReviewed[index] += 1;
  }

  for (const iso of newWordTimestamps) {
    const index = dayIndexOf(iso);
    if (index >= 0 && index < 7) dailyNewWords[index] += 1;
  }

  return { dailyReviewed, dailyNewWords };
}

const MS_PER_DAY = 86_400_000;

/** 把 "YYYY-MM-DD" 换成「距 1970-01-01 的天数」，方便做星期运算 */
function dayNumberFromKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 反过来：把天数换回 "YYYY-MM-DD" */
function keyFromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * 某个时刻所在这一周的周一（YYYY-MM-DD）。
 *
 * 用「周一」作为一周的起点，是因为周报要覆盖一整个自然周，
 * 而星期一是最自然的开始。
 */
export function weekStartOf(
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const dayNumber = dayNumberFromKey(localDateKey(now, timeZone));
  // 1970-01-01 是周四，所以 (天数 + 3) % 7 = 距本周一过了几天
  const daysSinceMonday = (dayNumber + 3) % 7;
  return keyFromDayNumber(dayNumber - daysSinceMonday);
}

/** 星期几：0 = 周一 …… 5 = 周六，6 = 周日 */
export function weekdayIndex(
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  return (dayNumberFromKey(localDateKey(now, timeZone)) + 3) % 7;
}

/**
 * 现在该不该发周报？
 *
 * 规则（用户要的是「每周末」）：
 *   1. 只在**周六或周日**发 —— 工作日打开网站不会突然收到周报
 *   2. 这一周已经发过就不再发（靠 lastSentWeekStart 判断）
 *
 * @param lastSentWeekStart 上一次发送覆盖的那一周的周一；从没发过就传 null
 */
export function isWeeklyReportDue(
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
  lastSentWeekStart: string | null = null,
): boolean {
  const index = weekdayIndex(now, timeZone);
  const isWeekend = index >= 5;
  if (!isWeekend) return false;

  return lastSentWeekStart !== weekStartOf(now, timeZone);
}

/**
 * 这一周的哪几天已经过完了（周报只列到今天为止，
 * 免得周六发的周报里周日那一行永远是 0，看着像漏了）。
 */
export function daysElapsedInWeek(
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  return weekdayIndex(now, timeZone) + 1;
}
