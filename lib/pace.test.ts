/**
 * 学习节奏估算的自动测试。
 *
 * 这套推算决定「首页告诉你什么时候能背完」。算错了会让你误判进度 ——
 * 比如明明来不及却显示一切正常。所以它值得钉住。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimatePace,
  EXAM_DATE_ISO,
  PACE_WINDOW_DAYS,
  suggestDailyNewWordGoal,
} from "./pace";

const NOW = new Date("2026-10-12T10:00:00.000Z");

/**
 * 造一个长度为 14 的每日新词数组。
 * @param counts 从最早到最近的每日新词数（不足 14 天时，前面自动补 0）
 */
function daily(counts: number[]): number[] {
  const padding = PACE_WINDOW_DAYS - counts.length;
  return [...Array(Math.max(0, padding)).fill(0), ...counts];
}

describe("数据不足的情况", () => {
  it("最近两周完全没学习时，给不出预计完成时间", () => {
    const result = estimatePace(daily([0, 0, 0]), 100, NOW);

    assert.equal(result.avgPerDay, 0);
    assert.equal(result.daysToFinish, null);
    assert.equal(result.projectedFinishDate, null);
    assert.equal(result.paceVerdict, "unknown");
    assert.equal(result.onTrack, false, "没有数据时不能谎报「来得及」");
  });

  it("已经有了学习记录时才给出估算", () => {
    const result = estimatePace(daily([10, 10, 10]), 100, NOW);
    assert.ok(result.avgPerDay > 0);
    assert.notEqual(result.daysToFinish, null);
    assert.notEqual(result.projectedFinishDate, null);
  });
});

describe("平均节奏的计算", () => {
  it("从「第一次学习那天」开始算，而不是死板用满 14 天", () => {
    // 只有最近 3 天学了，每天 20 个。
    // 如果按 14 天平均会得到 60/14 ≈ 4.3 个 —— 严重偏低。
    const result = estimatePace(daily([20, 20, 20]), 100, NOW);

    assert.equal(result.windowDays, 3, "应该只统计开始学习后的这 3 天");
    assert.equal(result.totalNewWords, 60);
    assert.equal(result.avgPerDay, 20, "平均应该是每天 20 个，而不是 4.3 个");
    assert.equal(result.activeDays, 3);
  });

  it("休息日也算进平均里（这才是真实可持续的节奏）", () => {
    // 4 天里学了 2 天，各 20 个 → 平均 10 个/天
    const result = estimatePace(daily([20, 0, 20, 0]), 100, NOW);

    assert.equal(result.windowDays, 4);
    assert.equal(result.totalNewWords, 40);
    assert.equal(result.avgPerDay, 10);
    assert.equal(result.activeDays, 2);
  });
});

describe("预计完成时间", () => {
  it("剩余词数 ÷ 平均节奏 = 还要多少天", () => {
    const result = estimatePace(daily([20, 20]), 200, NOW);
    assert.equal(result.avgPerDay, 20);
    assert.equal(result.daysToFinish, 10, "200 个词、每天 20 个，还要 10 天");
  });

  it("除不尽时向上取整（宁可多算一天，也不要少算）", () => {
    const result = estimatePace(daily([20]), 45, NOW);
    assert.equal(result.daysToFinish, 3, "45 ÷ 20 = 2.25，应该算 3 天");
  });

  it("已经背完时，预计天数直接是 0", () => {
    const result = estimatePace(daily([20, 20]), 0, NOW);

    assert.equal(result.daysToFinish, 0);
    assert.equal(result.onTrack, true);
    assert.equal(result.paceVerdict, "ahead");
  });

  it("预计完成日期是个合法的 YYYY-MM-DD", () => {
    const result = estimatePace(daily([10, 10]), 100, NOW);
    assert.match(String(result.projectedFinishDate), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("和考试日期对比", () => {
  it("距离考试的天数是正数（考试还没到）", () => {
    const result = estimatePace(daily([10, 10]), 100, NOW);
    assert.ok(result.daysUntilExam > 0);
    assert.ok(result.daysUntilExam < 1000, "两年内应该考完");
  });

  it("背得够快 → 判定为来得及", () => {
    // 每天 50 个、只剩 100 个 → 2 天背完，远早于考试
    const result = estimatePace(daily([50, 50]), 100, NOW);

    assert.equal(result.onTrack, true);
    assert.equal(result.paceVerdict, "ahead");
  });

  it("背得太慢 → 判定为来不及，并给出每天需要多少", () => {
    // 每天 1 个、还剩 5 万个词 → 要 5 万天，肯定来不及
    const result = estimatePace(daily([1, 1]), 50000, NOW);

    assert.equal(result.onTrack, false);
    assert.equal(result.paceVerdict, "behind");
    assert.ok(
      result.requiredPerDay > result.avgPerDay,
      "需要的节奏应该高于当前节奏",
    );
    assert.ok(result.requiredPerDay > 0);
  });

  it("requiredPerDay 就是「剩余词数 ÷ 距离考试天数」向上取整", () => {
    const result = estimatePace(daily([10, 10]), 1000, NOW);
    const expected = Math.ceil(1000 / result.daysUntilExam);
    assert.equal(result.requiredPerDay, expected);
  });

  it("考试日期是可配置的常量，格式必须合法", () => {
    assert.match(EXAM_DATE_ISO, /^\d{4}-\d{2}-\d{2}$/);

    // 同一个慢节奏（每天 1 个），考试日期不同，结论应该不同：
    // 剩 5000 个词、每天 1 个 → 要 5000 天（约 13.7 年）
    const soon = estimatePace(daily([1, 1]), 5000, NOW);
    assert.equal(soon.onTrack, false, "按默认考试日期应该来不及");

    const late = estimatePace(
      daily([1, 1]),
      5000,
      NOW,
      "Asia/Shanghai",
      "2099-12-25",
    );
    assert.equal(late.onTrack, true, "考试推到很晚时，同样的节奏就来得及了");
  });
});

describe("suggestDailyNewWordGoal：今天安排多少新词", () => {
  it("没有任何记录时给一个保守的起步值", () => {
    assert.equal(suggestDailyNewWordGoal(0), 20);
  });

  it("跟着自己的实际节奏走", () => {
    assert.equal(suggestDailyNewWordGoal(12.4), 12);
    assert.equal(suggestDailyNewWordGoal(35), 35);
  });

  it("下限 5 个：太少会让进度停滞", () => {
    assert.equal(suggestDailyNewWordGoal(1), 5);
    assert.equal(suggestDailyNewWordGoal(0.3), 5);
  });

  it("上限 60 个：太多会让你第二天不想打开", () => {
    assert.equal(suggestDailyNewWordGoal(200), 60);
  });
});
