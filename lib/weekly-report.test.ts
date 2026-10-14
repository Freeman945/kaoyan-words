/**
 * 背词周报的自动测试。
 *
 * 周报是每周唯一一次「回头看看」的机会。里面的数字算错了，
 * 会误导你对自己的判断（比如明明退步了却显示一直在进步）。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWeeklyReport,
  summarizeWeek,
  type WeeklyReportData,
} from "./weekly-report";

/** 造一份「正常学习了一周」的数据 */
function reportData(
  overrides: Partial<WeeklyReportData> = {},
): WeeklyReportData {
  return {
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    dailyReviewed: [20, 25, 0, 30, 18, 22, 12],
    dailyNewWords: [15, 20, 0, 20, 15, 18, 12],
    streakDays: 6,
    learnedWords: 98,
    totalWords: 5000,
    masteredWords: 12,
    weakWords: [
      { word: "abandon", meaning: "放弃", wrongCount: 4, stars: 1 },
      { word: "vague", meaning: "模糊的", wrongCount: 3, stars: 2 },
    ],
    avgPerDay: 14,
    projectedFinishDate: "2027-06-01",
    daysUntilExam: 440,
    requiredPerDay: 12,
    ...overrides,
  };
}

describe("周报标题", () => {
  it("带上起止日期和本周新学词数", () => {
    const { subject } = buildWeeklyReport(reportData());
    assert.ok(subject.includes("2026-10-05"));
    assert.ok(subject.includes("2026-10-11"));
    assert.ok(subject.includes("100"), `标题应该包含本周新学总数，实际: ${subject}`);
  });
});

describe("正文内容", () => {
  it("正文里给出本周作答次数和新学词数", () => {
    const { text } = buildWeeklyReport(reportData());
    // 20+25+0+30+18+22+12 = 127
    assert.ok(text.includes("127"), "应该包含本周作答总次数");
    assert.ok(text.includes("100"), "应该包含本周新学词数");
  });

  it("七个星期几都列出来", () => {
    const { text } = buildWeeklyReport(reportData());
    for (const name of ["一", "二", "三", "四", "五", "六", "日"]) {
      assert.ok(text.includes(`周${name}`), `缺少周${name}`);
    }
  });

  it("包含进度和连续天数", () => {
    const { text } = buildWeeklyReport(reportData());
    assert.ok(text.includes("98"), "应包含已学词数");
    assert.ok(text.includes("5000"), "应包含词库总数");
    assert.ok(text.includes("12"), "应包含已掌握词数");
    assert.ok(text.includes("6"), "应包含连续学习天数");
  });

  it("列出最该盯的词，并且画出星级", () => {
    const { text } = buildWeeklyReport(reportData());
    assert.ok(text.includes("abandon"));
    assert.ok(text.includes("vague"));
    assert.ok(text.includes("★☆☆☆☆"), "1 颗星的词应该画成 ★☆☆☆☆");
    assert.ok(text.includes("错 4 次"));
  });

  it("给出预计背完日期和考试倒计时", () => {
    const { text } = buildWeeklyReport(reportData());
    assert.ok(text.includes("2027-06-01"));
    assert.ok(text.includes("440"));
  });

  it("HTML 版本也包含关键信息", () => {
    const { html } = buildWeeklyReport(reportData());
    assert.ok(html.includes("abandon"));
    assert.ok(html.includes("2027-06-01"));
    assert.ok(html.startsWith("<!doctype html>"));
  });
});

describe("来得及 / 来不及的判断", () => {
  it("节奏够快时说「来得及」", () => {
    // 需要每天 5 个，实际每天 14 个 → 来得及
    const { text } = buildWeeklyReport(
      reportData({ avgPerDay: 14, requiredPerDay: 5 }),
    );
    assert.ok(text.includes("来得及"), "应该给出「来得及」的结论");
  });

  it("节奏不够时明确说要每天背多少", () => {
    const { text } = buildWeeklyReport(
      reportData({ avgPerDay: 3, requiredPerDay: 25 }),
    );
    assert.ok(text.includes("背不完"), "应该明确说背不完");
    assert.ok(text.includes("25"), "应该给出每天需要的数量");
  });
});

describe("没有学习记录的一周", () => {
  it("不报错，也不指责，而是给一句鼓励", () => {
    const { text, subject } = buildWeeklyReport(
      reportData({
        dailyReviewed: [0, 0, 0, 0, 0, 0, 0],
        dailyNewWords: [0, 0, 0, 0, 0, 0, 0],
        avgPerDay: 0,
        projectedFinishDate: null,
      }),
    );

    assert.ok(text.includes("没有背词记录"));
    assert.ok(text.includes("休息也是学习的一部分"));
    assert.ok(subject.includes("0"), "标题里的新学词数应该是 0");
  });

  it("数据不足时不显示预计完成时间", () => {
    const { text } = buildWeeklyReport(
      reportData({ projectedFinishDate: null, avgPerDay: 0 }),
    );
    assert.ok(text.includes("学习记录还太少"));
  });

  it("没有重点词时不会出现空的标题", () => {
    const { text } = buildWeeklyReport(reportData({ weakWords: [] }));
    assert.ok(!text.includes("本周最该盯的几个词"));
  });
});

describe("summarizeWeek：把时间戳归到周一到周日", () => {
  // 2026-10-05 是周一
  const weekStart = new Date("2026-10-05T00:00:00+08:00");

  it("周一的事件落在下标 0，周日落在下标 6", () => {
    const result = summarizeWeek(
      [
        "2026-10-05T10:00:00+08:00", // 周一
        "2026-10-11T10:00:00+08:00", // 周日
      ],
      [],
      weekStart,
      "Asia/Shanghai",
    );

    assert.equal(result.dailyReviewed[0], 1, "周一应该有 1 次");
    assert.equal(result.dailyReviewed[6], 1, "周日应该有 1 次");
  });

  it("同一天多次作答会累加", () => {
    const result = summarizeWeek(
      [
        "2026-10-07T09:00:00+08:00",
        "2026-10-07T10:00:00+08:00",
        "2026-10-07T11:00:00+08:00",
      ],
      [],
      weekStart,
      "Asia/Shanghai",
    );

    assert.equal(result.dailyReviewed[2], 3, "周三应该有 3 次");
    assert.equal(result.dailyReviewed.reduce((a, b) => a + b, 0), 3);
  });

  it("新学词数和作答次数分开统计", () => {
    const result = summarizeWeek(
      ["2026-10-06T09:00:00+08:00", "2026-10-06T10:00:00+08:00"],
      ["2026-10-06T09:00:00+08:00"],
      weekStart,
      "Asia/Shanghai",
    );

    assert.equal(result.dailyReviewed[1], 2);
    assert.equal(result.dailyNewWords[1], 1);
  });

  it("本周之外的时间戳会被忽略（不会算进任何一天）", () => {
    const result = summarizeWeek(
      [
        "2026-10-04T10:00:00+08:00", // 上周日，早了一天
        "2026-10-12T10:00:00+08:00", // 下周一，晚了一天
      ],
      [],
      weekStart,
      "Asia/Shanghai",
    );

    assert.equal(result.dailyReviewed.reduce((a, b) => a + b, 0), 0);
    assert.equal(result.dailyReviewed.length, 7, "永远返回 7 天");
  });

  it("没有记录时返回 7 个 0，不报错", () => {
    const result = summarizeWeek([], [], weekStart, "Asia/Shanghai");
    assert.deepEqual(result.dailyReviewed, [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(result.dailyNewWords, [0, 0, 0, 0, 0, 0, 0]);
  });
});
