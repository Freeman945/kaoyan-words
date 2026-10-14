/**
 * 艾宾浩斯复习算法的自动测试。
 *
 * 为什么算法要单独写测试？
 * 复习节奏是这个网站的核心规则。以后你可能会想「5 分钟太短了，改成 10 分钟吧」，
 * 改完如果没测试，你得手动背好几个词才能看出有没有改坏。
 * 有了测试，跑一条 `npm test` 就知道规则还对不对。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGAIN_INTERVAL_MINUTES,
  calculateStars,
  createInitialProgress,
  describeInterval,
  describeReviewPlan,
  INITIAL_STARS,
  isDue,
  MASTERED_STREAK,
  MAX_IN_SESSION_REPEATS,
  MAX_STARS,
  MIN_STARS,
  REVIEW_INTERVALS_MINUTES,
  scheduleNextReview,
  shouldRequeueInSession,
  starsOf,
  type ReviewInput,
} from "./spaced-repetition";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 固定一个「现在」，这样测试结果才有唯一答案。
// 如果直接用 new Date()，每次跑的时间都不同，就没法断言了。
const NOW = new Date("2026-10-12T10:00:00.000Z");

/** 生成「NOW 之后 N 分钟」的 ISO 字符串，用于和算法结果比对 */
function minutesLater(minutes: number): string {
  return new Date(NOW.getTime() + minutes * MINUTE_MS).toISOString();
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

describe("复习阶梯本身", () => {
  it("阶梯从 1 分钟起步，前三档都在一次学习之内", () => {
    assert.equal(REVIEW_INTERVALS_MINUTES[0], 1, "第一档应该是 1 分钟");
    assert.equal(REVIEW_INTERVALS_MINUTES[1], 5, "第二档应该是 5 分钟");
    assert.equal(REVIEW_INTERVALS_MINUTES[2], 15, "第三档应该是 15 分钟");
    assert.equal(REVIEW_INTERVALS_MINUTES[3], 24 * 60, "第四档应该是 1 天");

    // 这一条是用户提出的问题换来的：前三档如果长到一次学习装不下，
    // 它们就永远不会在本轮里发生，等于白设。
    assert.ok(
      REVIEW_INTERVALS_MINUTES[2] <= 30,
      "第三档不应该超过 30 分钟，否则一次正常学习够不着",
    );
  });

  it("间隔必须严格递增，否则「越背越熟」就不成立了", () => {
    for (let i = 1; i < REVIEW_INTERVALS_MINUTES.length; i += 1) {
      assert.ok(
        REVIEW_INTERVALS_MINUTES[i] > REVIEW_INTERVALS_MINUTES[i - 1],
        `第 ${i + 1} 档必须比前一档长`,
      );
    }
  });

  it("describeReviewPlan 能把整条阶梯翻译成中文", () => {
    const plan = describeReviewPlan();
    assert.equal(plan.length, REVIEW_INTERVALS_MINUTES.length);
    assert.equal(plan[0].label, "1 分钟后");
    assert.equal(plan[1].label, "5 分钟后");
    assert.equal(plan[2].label, "15 分钟后");
    assert.equal(plan[3].label, "1 天后");
    assert.equal(plan[0].mastered, false);
  });
});

describe("点击「不认识」", () => {
  it("5 分钟后重来，掌握程度归零，连击清零", () => {
    const result = scheduleNextReview(
      progressAfter({ familiarity: 2, consecutive_correct: 5 }),
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

  it("就算已经背到很高的档位，答错也一律归零", () => {
    const result = scheduleNextReview(
      progressAfter({ consecutive_correct: 9, familiarity: 3 }),
      "again",
      NOW,
    );

    assert.equal(result.consecutive_correct, 0);
    assert.equal(result.next_review_time, minutesLater(AGAIN_INTERVAL_MINUTES));
  });
});

describe("点击「模糊」", () => {
  it("往下退一档，而不是直接退回原点", () => {
    // 连击 5 次时正常间隔是阶梯第 5 档（2 天）；
    // 模糊之后应该退到第 4 档（1 天），而不是打回 5 分钟。
    const result = scheduleNextReview(
      progressAfter({ consecutive_correct: 5 }),
      "hard",
      NOW,
    );

    assert.equal(result.next_review_time, minutesLater(24 * 60), "应退到 1 天");
    assert.equal(result.familiarity, 1);
    assert.equal(result.consecutive_correct, 4);
  });

  it("连击很低时会退到阶梯最前面（1 分钟）", () => {
    const result = scheduleNextReview(
      progressAfter({ consecutive_correct: 1 }),
      "hard",
      NOW,
    );
    assert.equal(result.next_review_time, minutesLater(1));
    assert.equal(result.consecutive_correct, 0);
  });

  it("已经是最低档时不会退成负数", () => {
    const result = scheduleNextReview(
      progressAfter({ consecutive_correct: 0 }),
      "hard",
      NOW,
    );
    assert.equal(result.next_review_time, minutesLater(1));
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

describe("点击「认识」的艾宾浩斯阶梯", () => {
  it("连续答对时，间隔严格按阶梯依次拉长", () => {
    let progress: ReviewInput = createInitialProgress();

    REVIEW_INTERVALS_MINUTES.forEach((expectedMinutes, index) => {
      const result = scheduleNextReview(progress, "good", NOW);

      assert.equal(
        result.next_review_time,
        minutesLater(expectedMinutes),
        `第 ${index + 1} 次连续答对，间隔应该是 ${expectedMinutes} 分钟`,
      );
      assert.equal(result.consecutive_correct, index + 1, "连击数应该 +1");

      progress = result;
    });
  });

  it("前三次答对的间隔都在当天之内（这是艾宾浩斯的关键）", () => {
    let progress: ReviewInput = createInitialProgress();

    const firstThree: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = scheduleNextReview(progress, "good", NOW);
      const diffMinutes =
        (new Date(result.next_review_time).getTime() - NOW.getTime()) / MINUTE_MS;
      firstThree.push(diffMinutes);
      progress = result;
    }

    assert.deepEqual(firstThree, [1, 5, 15]);
    assert.ok(
      firstThree.every((minutes) => minutes < 30),
      "前三次都应该在一次正常学习之内再见，把第一波遗忘压住",
    );
  });

  it(`连击满 ${MASTERED_STREAK} 次（间隔排到 15 天）后标记为「已掌握」`, () => {
    let progress: ReviewInput = createInitialProgress();

    for (let i = 1; i <= MASTERED_STREAK; i += 1) {
      const result = scheduleNextReview(progress, "good", NOW);
      assert.equal(
        result.familiarity,
        i < MASTERED_STREAK ? 2 : 3,
        `第 ${i} 次连续答对后的掌握程度不对`,
      );
      progress = result;
    }
  });

  it("超过最长阶梯后一直沿用最长间隔，不会越滚越大", () => {
    const longest =
      REVIEW_INTERVALS_MINUTES[REVIEW_INTERVALS_MINUTES.length - 1];

    const result = scheduleNextReview(
      progressAfter({ consecutive_correct: 20, familiarity: 3 }),
      "good",
      NOW,
    );

    assert.equal(result.next_review_time, minutesLater(longest));
    assert.equal(result.familiarity, 3, "已掌握的词继续保持已掌握");
  });
});

describe("答错会打断连续答对", () => {
  it("答对 3 次后点「不认识」，阶梯从头开始", () => {
    let progress: ReviewInput = createInitialProgress();
    progress = scheduleNextReview(progress, "good", NOW);
    progress = scheduleNextReview(progress, "good", NOW);
    progress = scheduleNextReview(progress, "good", NOW);
    assert.equal(progress.consecutive_correct, 3);

    progress = scheduleNextReview(progress, "again", NOW);
    assert.equal(progress.consecutive_correct, 0);

    // 再答对一次，间隔应该回到最短的 1 分钟，而不是接着 1 天
    const afterRecovery = scheduleNextReview(progress, "good", NOW);
    assert.equal(afterRecovery.next_review_time, minutesLater(1));
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

  it("5 分钟说「5 分钟后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 5 * MINUTE_MS)),
      "5 分钟后",
    );
  });

  it("12 小时说「12 小时后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 12 * HOUR_MS)),
      "12 小时后",
    );
  });

  it("2 天说「2 天后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 2 * DAY_MS)),
      "2 天后",
    );
  });

  it("120 天说「120 天后」", () => {
    assert.equal(
      describeInterval(NOW, new Date(NOW.getTime() + 120 * DAY_MS)),
      "120 天后",
    );
  });
});

/**
 * 这一组测试来自用户提出的一个很实在的问题:
 * 「第一次答对后是 5 分钟后，第二次 30 分钟后 —— 你有没有想过
 *   我一次背不了 30 分钟？」
 *
 * 顺着这个问题查下去发现了更严重的事: 如果本轮队列是固定的，
 * 那么「5 分钟后」这个词在本轮里根本不会再出现，只能等下次打开网站，
 * 那时它早就逾期了。前三档等于白设。
 *
 * 所以加了「本轮之内重新排队」的规则，这里把规则钉住。
 */
describe("shouldRequeueInSession：短间隔的词要在本轮内再考一次", () => {
  it("刚答对（1 分钟后）→ 要重新排队", () => {
    assert.equal(
      shouldRequeueInSession(minutesLater(AGAIN_INTERVAL_MINUTES), NOW, 0),
      true,
    );
  });

  it("阶梯前三档（1 / 5 / 15 分钟）都应该重新排队", () => {
    for (const minutes of [1, 5, 15]) {
      assert.equal(
        shouldRequeueInSession(minutesLater(minutes), NOW, 0),
        true,
        `${minutes} 分钟这一档应该在本轮内重排`,
      );
    }
  });

  it("到了「1 天后」就不该在本轮里重排了", () => {
    assert.equal(shouldRequeueInSession(minutesLater(24 * 60), NOW, 0), false);
  });

  it("已经重排够次数后不再重排（否则一直点不认识会死循环）", () => {
    assert.equal(
      shouldRequeueInSession(minutesLater(1), NOW, MAX_IN_SESSION_REPEATS),
      false,
    );
    assert.equal(
      shouldRequeueInSession(minutesLater(1), NOW, MAX_IN_SESSION_REPEATS - 1),
      true,
      "还没到上限时应该继续重排",
    );
  });

  it("刚点过不认识的词（1 分钟后）也应该马上回到队列里", () => {
    const result = scheduleNextReview(createInitialProgress(), "again", NOW);
    assert.equal(
      shouldRequeueInSession(result.next_review_time, NOW, 0),
      true,
      "刚才不会的词必须在本轮里再考一次，不能留到明天",
    );
  });
});

/**
 * 星级熟练度（0~5 颗）—— 规则由用户定:
 *   新词 3 颗，认识 +1，不认识 -1，模糊不动，范围 0~5。
 *
 * 这套规则不需要新增数据库字段: 因为「模糊」两边都不计数，
 * 所以 `3 + 答对次数 - 答错次数` 正好等价于上面这套加减法。
 */
describe("星级熟练度（0~5 颗）", () => {
  it("新词是 3 颗星", () => {
    assert.equal(INITIAL_STARS, 3);
    assert.equal(calculateStars(0, 0), 3);
  });

  it("点一次「认识」加一颗", () => {
    assert.equal(calculateStars(1, 0), 4);
    assert.equal(calculateStars(2, 0), 5);
  });

  it("点一次「不认识」减一颗", () => {
    assert.equal(calculateStars(0, 1), 2);
    assert.equal(calculateStars(0, 2), 1);
    assert.equal(calculateStars(0, 3), 0);
  });

  it("上限 5 颗，不会无限涨", () => {
    assert.equal(MAX_STARS, 5);
    assert.equal(calculateStars(10, 0), MAX_STARS);
  });

  it("下限 0 颗，不会变成负数", () => {
    assert.equal(MIN_STARS, 0);
    assert.equal(calculateStars(0, 10), MIN_STARS);
  });

  it("点「模糊」不加不减（因为模糊两边都不计数）", () => {
    const before = progressAfter({ correct_count: 2, wrong_count: 1 });
    const after = scheduleNextReview(before, "hard", NOW);

    assert.equal(after.correct_count, before.correct_count);
    assert.equal(after.wrong_count, before.wrong_count);
    assert.equal(
      calculateStars(after.correct_count, after.wrong_count),
      calculateStars(before.correct_count, before.wrong_count),
      "模糊之后星级应该原封不动",
    );
  });

  it("真的是「点一次动一颗」：连着点认识会一路涨到顶", () => {
    let progress: ReviewInput = createInitialProgress();
    const stars: number[] = [starsOf(progress)];

    for (let i = 0; i < 3; i += 1) {
      progress = scheduleNextReview(progress, "good", NOW);
      stars.push(starsOf(progress));
    }

    assert.deepEqual(stars, [3, 4, 5, 5], "涨到 5 颗就停住");
  });

  it("答错会把星级拉下来", () => {
    let progress: ReviewInput = createInitialProgress();
    progress = scheduleNextReview(progress, "good", NOW); // 4 颗
    progress = scheduleNextReview(progress, "good", NOW); // 5 颗
    assert.equal(starsOf(progress), 5);

    progress = scheduleNextReview(progress, "again", NOW); // 掉回 4 颗
    assert.equal(starsOf(progress), 4);
  });

  it("starsOf 能从进度记录上直接取星级", () => {
    assert.equal(starsOf({ correct_count: 3, wrong_count: 1 }), 5);
    assert.equal(starsOf({ correct_count: 0, wrong_count: 0 }), 3);
  });
});
