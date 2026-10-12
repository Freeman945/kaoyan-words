/**
 * 间隔复习算法的自动测试。
 *
 * 为什么算法要单独写测试？
 * 复习节奏是这个网站的核心规则。以后你可能会想「3 天太短了，改成 5 天吧」，
 * 改完如果没测试，你得手动背好几个词才能看出有没有改坏。
 * 有了测试，跑一条 `npm test` 就知道规则还对不对。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGAIN_INTERVAL_MINUTES,
  CORRECT_INTERVALS_DAYS,
  createInitialProgress,
  describeInterval,
  isDue,
  scheduleNextReview,
  type ReviewInput,
} from "./spaced-repetition";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// 固定一个「现在」，这样测试结果才有唯一答案。
// 如果直接用 new Date()，每次跑的时间都不同，就没法断言了。
const NOW = new Date("2026-10-12T10:00:00.000Z");

/** 生成「NOW 之后 N 分钟」的 ISO 字符串，用于和算法结果比对 */
function minutesLater(minutes: number): string {
  return new Date(NOW.getTime() + minutes * MINUTE_MS).toISOString();
}

/** 生成「NOW 之后 N 天」的 ISO 字符串 */
function daysLater(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

/** 造一个「已经背过几次」的进度，避免每个测试都写一长串字段 */
function progressAfter(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return { ...createInitialProgress(), ...overrides };
}

describe("初始进度", () => {
  it("新词的掌握程度是 0、计数全是 0", () => {
    assert.deepEqual(createInitialProgress(), {
      familiarity: 0,
      consecutive_correct: 0,
      review_count: 0,
      correct_count: 0,
      wrong_count: 0,
    });
  });
});

describe("点击「不认识」", () => {
  it("10 分钟后再复习，掌握程度归零，连击清零", () => {
    const result = scheduleNextReview(
      progressAfter({ familiarity: 2, consecutive_correct: 3, correct_count: 4 }),
      "again",
      NOW,
    );

    assert.equal(result.next_review_time, minutesLater(AGAIN_INTERVAL_MINUTES));
    assert.equal(result.familiarity, 0);
    assert.equal(result.consecutive_correct, 0);
  });

  it("错词次数 +1，但答对次数不变", () => {
    const result = scheduleNextReview(
      progressAfter({ review_count: 5, correct_count: 4, wrong_count: 1 }),
      "again",
      NOW,
    );

    assert.equal(result.review_count, 6, "复习总次数应该 +1");
    assert.equal(result.wrong_count, 2, "错词次数应该 +1");
    assert.equal(result.correct_count, 4, "答对次数不应该变");
  });
});

describe("点击「模糊」", () => {
  it("1 天后再复习，掌握程度降到 1，连击清零", () => {
    const result = scheduleNextReview(
      progressAfter({ familiarity: 3, consecutive_correct: 4 }),
      "hard",
      NOW,
    );

    assert.equal(result.next_review_time, daysLater(1));
    assert.equal(result.familiarity, 1);
    assert.equal(result.consecutive_correct, 0);
  });

  it("既不算答对也不算答错", () => {
    const result = scheduleNextReview(
      progressAfter({ review_count: 2, correct_count: 2, wrong_count: 0 }),
      "hard",
      NOW,
    );

    assert.equal(result.correct_count, 2);
    assert.equal(result.wrong_count, 0);
    assert.equal(result.review_count, 3);
  });
});

describe("点击「认识」的间隔阶梯", () => {
  it("连续答对时，间隔依次是 3 → 7 → 14 → 30 → 60 天", () => {
    let progress: ReviewInput = createInitialProgress();

    CORRECT_INTERVALS_DAYS.forEach((expectedDays, index) => {
      const result = scheduleNextReview(progress, "good", NOW);

      assert.equal(
        result.next_review_time,
        daysLater(expectedDays),
        `第 ${index + 1} 次连续答对，间隔应该是 ${expectedDays} 天`,
      );
      assert.equal(
        result.consecutive_correct,
        index + 1,
        "连击数应该跟着 +1",
      );

      progress = result;
    });
  });

  it("连击满 4 次（走完 30 天）后标记为「已掌握」", () => {
    let progress: ReviewInput = createInitialProgress();

    for (let i = 0; i < 4; i += 1) {
      const result = scheduleNextReview(progress, "good", NOW);
      // 前 3 次还是「认识」（2），第 4 次才升级为「已掌握」（3）
      assert.equal(
        result.familiarity,
        i < 3 ? 2 : 3,
        `第 ${i + 1} 次连续答对后的掌握程度不对`,
      );
      progress = result;
    }
  });

  it("超过最长阶梯后，一直沿用 60 天，不会越滚越大", () => {
    const progress = progressAfter({ consecutive_correct: 10, familiarity: 3 });
    const result = scheduleNextReview(progress, "good", NOW);

    assert.equal(result.next_review_time, daysLater(60));
    assert.equal(result.familiarity, 3, "已掌握的词继续保持已掌握");
  });
});

describe("答错会打断连续答对", () => {
  it("答对 2 次后点「不认识」，阶梯重新从第 1 档（3 天）开始", () => {
    // 先连续答对 2 次
    let progress: ReviewInput = createInitialProgress();
    progress = scheduleNextReview(progress, "good", NOW);
    progress = scheduleNextReview(progress, "good", NOW);
    assert.equal(progress.consecutive_correct, 2);

    // 第三次点「不认识」
    progress = scheduleNextReview(progress, "again", NOW);
    assert.equal(progress.consecutive_correct, 0);

    // 再答对一次，间隔应该回到最短的 3 天，而不是接着 14 天
    const afterRecovery = scheduleNextReview(progress, "good", NOW);
    assert.equal(afterRecovery.next_review_time, daysLater(3));
    assert.equal(afterRecovery.consecutive_correct, 1);
  });
});

describe("isDue：判断该不该复习", () => {
  it("从没复习过的词（null）算该复习", () => {
    assert.equal(isDue(null, NOW), true);
  });

  it("next_review_time 在过去 → 该复习", () => {
    assert.equal(isDue(minutesLater(-1), NOW), true);
  });

  it("next_review_time 刚好等于现在 → 该复习", () => {
    assert.equal(isDue(NOW.toISOString(), NOW), true);
  });

  it("next_review_time 在未来 → 还不该复习", () => {
    assert.equal(isDue(minutesLater(1), NOW), false);
  });
});

describe("describeInterval：把间隔说成人话", () => {
  it("不到 1 分钟说「马上」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 30 * 1000)),
      "马上",
    );
  });

  it("10 分钟说「10 分钟后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 10 * MINUTE_MS)),
      "10 分钟后",
    );
  });

  it("2 小时说「2 小时后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 2 * 60 * MINUTE_MS)),
      "2 小时后",
    );
  });

  it("3 天说「3 天后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 3 * DAY_MS)),
      "3 天后",
    );
  });
});
