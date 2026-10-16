/**
 * 学习统计的自动测试。
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDailyPlan,
  calculateStreak,
  countLast7Days,
  DEFAULT_NEW_WORD_LIMIT,
  localDateKey,
  summarizeProgress,
  type ProgressSummary,
  type ReviewLogSummary,
} from "./stats";

// 假装现在是 2026-10-12 18:00（北京时间）
// 注意它在 UTC 下是 2026-10-12T10:00Z，但在北京时间也是 10-12，正好用来验证时区换算
const NOW = new Date("2026-10-12T10:00:00.000Z");

const SHANGHAI = "Asia/Shanghai";
const UTC = "UTC";

/** 造一条进度记录 */
function progressRow(overrides: Partial<ProgressSummary> = {}): ProgressSummary {
  return { word_id: 1, familiarity: 0, next_review_time: null, ...overrides };
}

/** 造一条作答流水 */
function log(reviewed_at: string): ReviewLogSummary {
  return { reviewed_at, rating: "good" };
}

describe("localDateKey：按指定时区判断是哪一天", () => {
  it("UTC 下 23:30 算当天", () => {
    assert.equal(localDateKey(new Date("2026-10-11T23:30:00Z"), UTC), "2026-10-11");
  });

  it("同一时刻在北京时间算第二天（这是最容易出错的场景）", () => {
    // UTC 的 10-11 23:30 = 北京时间 10-12 07:30
    assert.equal(
      localDateKey(new Date("2026-10-11T23:30:00Z"), SHANGHAI),
      "2026-10-12",
    );
  });

  it("北京时间比 UTC 早 8 小时", () => {
    // UTC 10-11 17:00 = 北京 10-12 01:00
    assert.equal(localDateKey(new Date("2026-10-11T17:00:00Z"), UTC), "2026-10-11");
    assert.equal(
      localDateKey(new Date("2026-10-11T17:00:00Z"), SHANGHAI),
      "2026-10-12",
    );
  });
});

describe("summarizeProgress：汇总各种数量", () => {
  it("统计总词数、已掌握、学习中", () => {
    const stats = summarizeProgress(
      [
        progressRow({ word_id: 1, familiarity: 3 }),
        progressRow({ word_id: 2, familiarity: 3 }),
        progressRow({ word_id: 3, familiarity: 2 }),
        progressRow({ word_id: 4, familiarity: 0 }),
      ],
      [],
      NOW,
      SHANGHAI,
    );

    assert.equal(stats.totalWords, 4);
    assert.equal(stats.masteredWords, 2);
    assert.equal(stats.learningWords, 2, "没掌握的都算在学");
  });

  it("没有任何进度时全是 0", () => {
    const stats = summarizeProgress([], [], NOW, SHANGHAI);
    assert.equal(stats.totalWords, 0);
    assert.equal(stats.masteredWords, 0);
    assert.equal(stats.dueForReview, 0);
    assert.equal(stats.reviewedToday, 0);
    assert.equal(stats.streakDays, 0);
  });

  it("只把 next_review_time 已过去的算成「待复习」", () => {
    const stats = summarizeProgress(
      [
        progressRow({ word_id: 1, next_review_time: "2026-10-12T09:00:00Z" }), // 已过期
        progressRow({ word_id: 2, next_review_time: "2026-10-12T10:00:00Z" }), // 正好现在
        progressRow({ word_id: 3, next_review_time: "2026-10-20T10:00:00Z" }), // 还没到
      ],
      [],
      NOW,
      SHANGHAI,
    );

    assert.equal(stats.dueForReview, 2, "过期和正好到点的都该复习");
  });

  it("从没复习过的词（null）也算待复习", () => {
    const stats = summarizeProgress(
      [progressRow({ word_id: 1, next_review_time: null })],
      [],
      NOW,
      SHANGHAI,
    );
    assert.equal(stats.dueForReview, 1);
  });

  it("reviewedToday 只数今天的，并且按北京时间判断", () => {
    const stats = summarizeProgress(
      [],
      [
        log("2026-10-11T23:30:00Z"), // 北京时间 10-12 07:30 → 今天
        log("2026-10-12T09:00:00Z"), // 北京时间 10-12 17:00 → 今天
        log("2026-10-11T10:00:00Z"), // 北京时间 10-11 18:00 → 昨天
      ],
      NOW,
      SHANGHAI,
    );

    assert.equal(stats.reviewedToday, 2);
  });

  it("如果错用 UTC，今天的学习量会被算错（说明时区参数真的起作用）", () => {
    const logs = [
      log("2026-10-11T23:30:00Z"), // 北京：10-12 今天 / UTC：10-11 昨天
      log("2026-10-12T09:00:00Z"), // 两边都是 10-12
    ];

    const shanghai = summarizeProgress([], logs, NOW, SHANGHAI);
    const utc = summarizeProgress([], logs, NOW, UTC);

    assert.equal(shanghai.reviewedToday, 2);
    assert.equal(utc.reviewedToday, 1, "用 UTC 会少数一次");
  });
});

describe("countLast7Days：最近 7 天每天的学习量", () => {
  const logs = [
    log("2026-10-12T09:00:00Z"), // 北京 10-12
    log("2026-10-11T23:30:00Z"), // 北京 10-12
    log("2026-10-11T02:00:00Z"), // 北京 10-11
    log("2026-10-06T02:00:00Z"), // 北京 10-06（窗口内最早一天）
    log("2026-10-05T02:00:00Z"), // 北京 10-05（窗口外，不该计入）
  ];

  it("总是返回 7 条，从 6 天前到今天", () => {
    const days = countLast7Days(logs, NOW, SHANGHAI);
    assert.equal(days.length, 7);
    assert.equal(days[0].date, "2026-10-06");
    assert.equal(days[6].date, "2026-10-12");
  });

  it("日期标签是 月/日 形式", () => {
    const days = countLast7Days(logs, NOW, SHANGHAI);
    assert.equal(days[0].label, "10/6");
    assert.equal(days[6].label, "10/12");
  });

  it("计数正确，没记录的那天是 0", () => {
    const days = countLast7Days(logs, NOW, SHANGHAI);
    const byDate = new Map(days.map((day) => [day.date, day.count]));

    assert.equal(byDate.get("2026-10-06"), 1);
    assert.equal(byDate.get("2026-10-07"), 0);
    assert.equal(byDate.get("2026-10-08"), 0);
    assert.equal(byDate.get("2026-10-09"), 0);
    assert.equal(byDate.get("2026-10-10"), 0);
    assert.equal(byDate.get("2026-10-11"), 1);
    assert.equal(byDate.get("2026-10-12"), 2);
  });

  it("7 天以前的记录不计入", () => {
    const days = countLast7Days(logs, NOW, SHANGHAI);
    const total = days.reduce((sum, day) => sum + day.count, 0);
    assert.equal(total, 4, "10-05 那条在窗口外，不该被算进去");
  });
});

describe("calculateStreak：连续学习天数", () => {
  it("没有记录时是 0", () => {
    assert.equal(calculateStreak([], NOW, SHANGHAI), 0);
  });

  it("只有今天学过是 1", () => {
    assert.equal(calculateStreak([log("2026-10-12T09:00:00Z")], NOW, SHANGHAI), 1);
  });

  it("今天、昨天、前天都学过是 3", () => {
    const logs = [
      log("2026-10-12T09:00:00Z"),
      log("2026-10-11T09:00:00Z"),
      log("2026-10-10T09:00:00Z"),
    ];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 3);
  });

  it("同一天多次学习只算一天", () => {
    const logs = [
      log("2026-10-12T01:00:00Z"),
      log("2026-10-12T09:00:00Z"),
      log("2026-10-12T15:00:00Z"),
    ];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 1);
  });

  it("中间断了一天，就从断点截断", () => {
    const logs = [
      log("2026-10-12T09:00:00Z"), // 今天
      log("2026-10-11T09:00:00Z"), // 昨天
      // 10-10 断了
      log("2026-10-09T09:00:00Z"),
      log("2026-10-08T09:00:00Z"),
    ];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 2);
  });

  it("今天还没学但昨天学了，连续天数保留（今天还没过完，不算断）", () => {
    const logs = [
      log("2026-10-11T09:00:00Z"), // 昨天
      log("2026-10-10T09:00:00Z"), // 前天
    ];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 2);
  });

  it("今天和昨天都没学，连续就断了", () => {
    const logs = [
      log("2026-10-10T09:00:00Z"),
      log("2026-10-09T09:00:00Z"),
    ];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 0);
  });

  it("连续天数也按北京时间判断，不受 UTC 影响", () => {
    // 这条在 UTC 下是 10-11，在北京时间是 10-12
    const logs = [log("2026-10-11T23:30:00Z")];
    assert.equal(calculateStreak(logs, NOW, SHANGHAI), 1, "北京时间算今天");
    assert.equal(calculateStreak(logs, NOW, UTC), 1, "UTC 算昨天，也保留连击");
  });
});

describe("buildDailyPlan：这一轮背哪些词", () => {
  it("复习词全排上，新词取兜底上限（调用方没指定 goal 时）", () => {
    const plan = buildDailyPlan({ dueCount: 12, newWordsAvailable: 100 });
    assert.equal(plan.reviewCount, 12);
    assert.equal(
      plan.newWordCount,
      DEFAULT_NEW_WORD_LIMIT,
      "没传 goal 时用兜底值，不是「每天必须背这么多」",
    );
    assert.equal(plan.total, 32);
  });

  it("词库不够时有多少学多少", () => {
    const plan = buildDailyPlan({ dueCount: 0, newWordsAvailable: 7 });
    assert.equal(plan.newWordCount, 7);
  });

  it("新词学完了就是 0", () => {
    const plan = buildDailyPlan({ dueCount: 5, newWordsAvailable: 0 });
    assert.equal(plan.newWordCount, 0);
    assert.equal(plan.total, 5);
  });

  it("可以自定义每天的新词数量", () => {
    const plan = buildDailyPlan({
      dueCount: 0,
      newWordsAvailable: 100,
      dailyNewWordGoal: 5,
    });
    assert.equal(plan.newWordCount, 5);
  });

  it("负数不会被算进来（防御性处理）", () => {
    const plan = buildDailyPlan({ dueCount: -3, newWordsAvailable: -1 });
    assert.equal(plan.reviewCount, 0);
    assert.equal(plan.newWordCount, 0);
    assert.equal(plan.total, 0);
  });
});
