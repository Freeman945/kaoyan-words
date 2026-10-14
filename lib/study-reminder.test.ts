/**
 * 晚间学习提醒的自动测试。
 *
 * 这个功能最怕两件事：
 *   1. 你已经背过了还来提醒你 —— 会让人立刻不想用它
 *   2. 一天发两封 —— 定时任务重试时会这样
 * 所以这两条必须钉住。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStudyReminderEmail,
  localHour,
  REMINDER_HOUR,
  shouldSendStudyReminder,
} from "./study-reminder";

/** 造一个北京时间的时间点 */
function beijing(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const pad = (value: number) => String(value).padStart(2, "0");
  return new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`,
  );
}

describe("localHour：取指定时区的小时数", () => {
  it("北京时间 22:00 → 22", () => {
    assert.equal(localHour(beijing(2026, 10, 14, 22), "Asia/Shanghai"), 22);
  });

  it("北京时间 00:00 → 0（不是 24）", () => {
    assert.equal(localHour(beijing(2026, 10, 14, 0), "Asia/Shanghai"), 0);
  });

  it("北京时间 9:30 → 9", () => {
    assert.equal(localHour(beijing(2026, 10, 14, 9, 30), "Asia/Shanghai"), 9);
  });

  it("同一个时刻在 UTC 下的小时数不同（说明时区确实生效了）", () => {
    const at = beijing(2026, 10, 14, 22);
    assert.equal(localHour(at, "Asia/Shanghai"), 22);
    assert.equal(localHour(at, "UTC"), 14);
  });
});

describe("shouldSendStudyReminder：什么时候该提醒", () => {
  const base = {
    reviewedToday: 0,
    alreadySentToday: false,
    timeZone: "Asia/Shanghai",
  };

  it("到点了、今天没学、也没发过 → 该发", () => {
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 14, 22) }),
      true,
    );
  });

  it("已经学过了 → 不发（这是最要紧的一条）", () => {
    assert.equal(
      shouldSendStudyReminder({
        ...base,
        now: beijing(2026, 10, 14, 22),
        reviewedToday: 1,
      }),
      false,
      "哪怕只背了一个词，也不该再催",
    );
  });

  it("今天已经发过 → 不再发（定时任务重试时会走到这条）", () => {
    assert.equal(
      shouldSendStudyReminder({
        ...base,
        now: beijing(2026, 10, 14, 22),
        alreadySentToday: true,
      }),
      false,
    );
  });

  it("还没到 22 点 → 不发", () => {
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 14, 21) }),
      false,
    );
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 14, 21, 59) }),
      false,
    );
  });

  it("刚好 22:00 → 发", () => {
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 14, 22, 0) }),
      true,
    );
  });

  it("深夜（23:59）也算过了 22 点", () => {
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 14, 23, 59) }),
      true,
    );
  });

  it("凌晨 1 点不算过了 22 点（换一天了，该等当天晚上）", () => {
    assert.equal(
      shouldSendStudyReminder({ ...base, now: beijing(2026, 10, 15, 1) }),
      false,
    );
  });

  it("提醒时间可以改", () => {
    const at21 = beijing(2026, 10, 14, 21);
    assert.equal(
      shouldSendStudyReminder({ ...base, now: at21, reminderHour: 21 }),
      true,
    );
    assert.equal(
      shouldSendStudyReminder({ ...base, now: at21, reminderHour: 22 }),
      false,
    );
  });

  it("默认提醒时间是 22 点", () => {
    assert.equal(REMINDER_HOUR, 22);
  });
});

describe("buildStudyReminderEmail：邮件内容", () => {
  const params = {
    dueForReview: 87,
    dailyNewWords: 30,
    streakDays: 12,
    appUrl: "https://kaoyan-words.vercel.app",
  };

  it("主题直接说清楚是什么事", () => {
    const { subject } = buildStudyReminderEmail(params);
    assert.equal(subject, "今天还没背单词");
  });

  it("正文给出三个数字和链接", () => {
    const { text } = buildStudyReminderEmail(params);

    assert.ok(text.includes("今天还没开始"));
    assert.ok(text.includes("87"), "应包含待复习数");
    assert.ok(text.includes("30"), "应包含新词数");
    assert.ok(text.includes("12"), "应包含连续天数");
    assert.ok(text.includes("https://kaoyan-words.vercel.app"));
  });

  it("连续天数为 0 时不写这一行（没意义）", () => {
    const { text } = buildStudyReminderEmail({ ...params, streakDays: 0 });
    assert.ok(!text.includes("连续学习"), "0 天不该出现连续学习的字样");
  });

  it("不写鼓励、不说教", () => {
    const { text, html } = buildStudyReminderEmail(params);

    // 这些词一旦出现，提醒就变味了
    for (const word of ["加油", "坚持", "别放弃", "记得", "哦", "吧"]) {
      assert.ok(!text.includes(word), `提醒邮件里不该出现「${word}」`);
      assert.ok(!html.includes(word), `HTML 里不该出现「${word}」`);
    }
  });

  it("HTML 版本同样包含数字", () => {
    const { html } = buildStudyReminderEmail(params);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("87"));
    assert.ok(html.includes("12 天"));
  });

  it("两个版本都不会渲染出 undefined", () => {
    const { text, html } = buildStudyReminderEmail(params);
    assert.ok(!text.includes("undefined"));
    assert.ok(!html.includes("undefined"));
  });
});
