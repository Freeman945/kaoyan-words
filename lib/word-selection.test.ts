/**
 * 概率出词算法的自动测试。
 *
 * 这些测试是「算法的说明书」：想改参数之前先跑一遍，
 * 看看哪些行为是你依赖的、哪些只是巧合。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_WEIGHT,
  calculateReviewPriority,
  FALLBACK_INTERVAL_MS,
  FORGETTING_POWER,
  frequencyFactorOf,
  masteryFactorOf,
  MAX_OVERDUE_RATIO,
  normalizeWeights,
  plannedIntervalMs,
  rankReviewCandidates,
  rawOverdueRatio,
  retentionAt,
  smoothedErrorRate,
  stableUnitInterval,
  STARVATION_OVERDUE_RATIO,
  TARGET_RETENTION,
  weightedShuffleKey,
  type ReviewCandidate,
} from "./word-selection";
import { moveResumeWordFirst } from "./study-resume";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 固定一个「现在」，测试里所有时间都相对它算，绝不依赖真实时钟 */
const NOW = new Date("2026-10-21T12:00:00.000Z");

/**
 * 造一个候选词。
 *
 * 默认：1 天前复习过，计划间隔 1 天（所以「现在」正好到期），
 * 复习 4 次、答对 4 次、答错 0 次、星级 4。
 */
function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  const last = new Date(NOW.getTime() - DAY).toISOString();
  const next = new Date(NOW.getTime()).toISOString();
  return {
    wordId: 1,
    lastReviewTime: last,
    nextReviewTime: next,
    reviewCount: 4,
    correctCount: 4,
    wrongCount: 0,
    stars: 4,
    ...overrides,
  };
}

/** 简化：算权重 */
function weightOf(overrides: Partial<ReviewCandidate> = {}): number {
  return calculateReviewPriority(candidate(overrides), NOW).weight;
}

/* ══════════════════════════════════════════════════════════
 * 1~3：遗忘概率模型
 * ══════════════════════════════════════════════════════════ */

describe("遗忘概率：R = TARGET_RETENTION ^ (t / 计划间隔)", () => {
  it("① 刚复习完（t = 0）→ 保持率 1，遗忘概率 0", () => {
    const priority = calculateReviewPriority(
      candidate({
        lastReviewTime: NOW.toISOString(),
        nextReviewTime: new Date(NOW.getTime() + DAY).toISOString(),
      }),
      NOW,
    );

    assert.equal(priority.retention, 1);
    assert.equal(priority.forgettingProbability, 0);
  });

  it("② 正好到计划复习时间 → 保持率 ≈ 0.60，遗忘概率 ≈ 0.40", () => {
    const priority = calculateReviewPriority(candidate(), NOW);

    // 允许浮点误差
    assert.ok(
      Math.abs(priority.retention - TARGET_RETENTION) < 1e-9,
      `保持率应约为 ${TARGET_RETENTION}，实际 ${priority.retention}`,
    );
    assert.ok(
      Math.abs(priority.forgettingProbability - (1 - TARGET_RETENTION)) < 1e-9,
      `遗忘概率应约为 ${1 - TARGET_RETENTION}，实际 ${priority.forgettingProbability}`,
    );
  });

  it("②补：走到计划间隔的一半时，保持率 = 0.6^0.5 ≈ 0.775", () => {
    const retention = retentionAt(0.5 * DAY, DAY);
    assert.ok(Math.abs(retention - Math.sqrt(TARGET_RETENTION)) < 1e-9);
  });

  it("③ 超期以后遗忘概率继续提高（单调）", () => {
    const atDue = calculateReviewPriority(candidate(), NOW).forgettingProbability;

    const late = calculateReviewPriority(
      candidate({
        // 计划 1 天，现在逾期了 1 天 → 总共过了 2 天
        nextReviewTime: new Date(NOW.getTime() - DAY).toISOString(),
        lastReviewTime: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      }),
      NOW,
    ).forgettingProbability;

    const later = calculateReviewPriority(
      candidate({
        nextReviewTime: new Date(NOW.getTime() - 3 * DAY).toISOString(),
        lastReviewTime: new Date(NOW.getTime() - 4 * DAY).toISOString(),
      }),
      NOW,
    ).forgettingProbability;

    assert.ok(later > late, "逾期 3 倍要比逾期 1 倍忘得更多");
    assert.ok(late > atDue, "逾期要比刚好到点忘得更多");
    // 上界：遗忘概率不会超过 1
    assert.ok(later <= 1);
  });

  it("保持率被 clamp 在 0~1（时钟异常时为 1，极端逾期时为 0）", () => {
    assert.equal(retentionAt(-1000, DAY), 1, "时间倒流（负经过时间）当作没忘");
    assert.ok(retentionAt(1000 * DAY, DAY) >= 0);
    assert.equal(retentionAt(Number.NaN, DAY), 0);
    assert.equal(retentionAt(DAY, 0), 0, "间隔为 0 不能除零");
  });
});

/* ══════════════════════════════════════════════════════════
 * 4：错误率
 * ══════════════════════════════════════════════════════════ */

describe("错误率：拉普拉斯平滑", () => {
  it("④ 答错越多，权重越高", () => {
    const clean = weightOf({ reviewCount: 10, wrongCount: 0, correctCount: 10 });
    const someWrong = weightOf({ reviewCount: 10, wrongCount: 5, correctCount: 5 });
    const allWrong = weightOf({ reviewCount: 10, wrongCount: 10, correctCount: 0 });

    assert.ok(someWrong > clean, "错过几次应该比从没错过更容易出现");
    assert.ok(allWrong > someWrong, "错得更多应该更容易出现");
  });

  it("新词/样本少时不会直接是 0 或 1", () => {
    assert.equal(smoothedErrorRate(0, 0), 0.5);
    assert.ok(Math.abs(smoothedErrorRate(1, 1) - 2 / 3) < 1e-9);
    assert.ok(smoothedErrorRate(100, 100) < 1, "就算全错也不到 100%");
    assert.ok(smoothedErrorRate(0, 100) > 0, "就算全对也不是 0%");
  });

  it("异常输入（负数、NaN）会被夹住", () => {
    assert.equal(smoothedErrorRate(-5, -5), 0.5);
    assert.ok(Number.isFinite(smoothedErrorRate(Number.NaN, Number.NaN)));
  });
});

/* ══════════════════════════════════════════════════════════
 * 5：逾期
 * ══════════════════════════════════════════════════════════ */

describe("逾期：越久权重越高，但有上限", () => {
  it("⑤ 逾期越久权重越高", () => {
    const onTime = weightOf();
    const lateOneDay = weightOf({
      nextReviewTime: new Date(NOW.getTime() - DAY).toISOString(),
    });
    const lateTwoDays = weightOf({
      nextReviewTime: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    });

    assert.ok(lateOneDay > onTime);
    assert.ok(lateTwoDays > lateOneDay);
  });

  it("⑤补 逾期比封顶后权重不再增长", () => {
    const atCap = weightOf({
      nextReviewTime: new Date(NOW.getTime() - MAX_OVERDUE_RATIO * DAY).toISOString(),
    });
    const wayBeyond = weightOf({
      nextReviewTime: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    });

    assert.ok(
      Math.abs(atCap - wayBeyond) < 1e-9,
      "逾期 30 天不该比逾期 2 天更强势，否则它会永远霸占队列",
    );
  });

  it("还没到期时逾期比是 0", () => {
    assert.equal(
      rawOverdueRatio(new Date(NOW.getTime() + DAY).toISOString(), DAY, NOW),
      0,
    );
  });

  it("逾期比在权重里只用到封顶值", () => {
    const priority = calculateReviewPriority(
      candidate({
        nextReviewTime: new Date(NOW.getTime() - 10 * DAY).toISOString(),
      }),
      NOW,
    );

    assert.equal(priority.overdueRatio, MAX_OVERDUE_RATIO);
    assert.ok(priority.rawOverdueRatio > MAX_OVERDUE_RATIO, "未封顶值要保留给饿死判定用");
  });
});

/* ══════════════════════════════════════════════════════════
 * 6：星级
 * ══════════════════════════════════════════════════════════ */

describe("星级：只是温和修正", () => {
  it("⑥ 低星权重略高于五星", () => {
    const zero = weightOf({ stars: 0 });
    const three = weightOf({ stars: 3 });
    const five = weightOf({ stars: 5 });

    assert.ok(zero > three);
    assert.ok(three > five);
  });

  it("修正幅度是温和的（1.0 ~ 1.5），不会盖过遗忘概率", () => {
    assert.equal(masteryFactorOf(0), 1.5);
    assert.ok(Math.abs(masteryFactorOf(3) - 1.2) < 1e-9);
    assert.equal(masteryFactorOf(5), 1.0);

    // 对比：遗忘概率从 0 到 1，(BASE+F)^POWER 放大的倍数远大于 1.5 倍
    const fresh = weightOf({ lastReviewTime: NOW.toISOString() });
    const forgotten = weightOf({ lastReviewTime: new Date(NOW.getTime() - 10 * DAY).toISOString() });
    assert.ok(
      forgotten / fresh > 1.5,
      "遗忘概率的影响必须大于星级的温和修正",
    );
  });
});

/* ══════════════════════════════════════════════════════════
 * 7~8：稳定性（刷新页面顺序不能乱变）
 * ══════════════════════════════════════════════════════════ */

describe("排序稳定性：同一天刷新不变，换一天可以变", () => {
  /** 造一批权重接近的候选词，用来观察排序 */
  function batch(): ReviewCandidate[] {
    return Array.from({ length: 8 }, (_unused, index) =>
      candidate({
        wordId: index + 1,
        reviewCount: 5,
        wrongCount: index % 3,
        stars: 4,
      }),
    );
  }

  it("⑦ 同一个 seedPrefix（同一用户同一天）→ 顺序完全一致", () => {
    const first = rankReviewCandidates(batch(), NOW, "user-a|2026-10-21");
    const second = rankReviewCandidates(batch(), NOW, "user-a|2026-10-21");

    assert.deepEqual(
      first.map((item) => item.candidate.wordId),
      second.map((item) => item.candidate.wordId),
    );
  });

  it("⑦补 不同用户 / 不同日期 → 打乱键不同（允许形成新顺序）", () => {
    const today = rankReviewCandidates(batch(), NOW, "user-a|2026-10-21");
    const tomorrow = rankReviewCandidates(batch(), NOW, "user-a|2026-10-22");

    assert.notDeepEqual(
      today.map((item) => item.candidate.wordId),
      tomorrow.map((item) => item.candidate.wordId),
      "换一天应该有新的概率顺序",
    );

    // 但同一天再算一次，仍然是稳定的
    const yesterdayAgain = rankReviewCandidates(batch(), NOW, "user-a|2026-10-21");
    assert.deepEqual(
      yesterdayAgain.map((item) => item.candidate.wordId),
      today.map((item) => item.candidate.wordId),
    );
  });

  it("不同词得到不同的打乱数（不会全部一样）", () => {
    const values = new Set<number>();
    for (let id = 1; id <= 50; id += 1) {
      values.add(stableUnitInterval(`user-a|2026-10-21|${id}`));
    }
    assert.ok(values.size > 40, `50 个词应该得到 40+ 个不同的数，实际 ${values.size}`);
  });

  it("打乱数永远在 (0,1) 开区间里", () => {
    for (const seed of ["", "a", "user|2026-10-21|1", "很长的中文种子".repeat(20)]) {
      const u = stableUnitInterval(seed);
      assert.ok(u > 0 && u < 1, `seed "${seed}" 得到 ${u}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════
 * 9~12：健壮性
 * ══════════════════════════════════════════════════════════ */

describe("权重永远健康：finite、> 0、不是 NaN", () => {
  it("⑨ 各种正常输入", () => {
    const cases: ReviewCandidate[] = [
      candidate({ wordId: 1, stars: 0, reviewCount: 0, wrongCount: 0 }),
      candidate({ wordId: 2, stars: 5, reviewCount: 999, wrongCount: 999 }),
      candidate({ wordId: 3, reviewCount: 1, wrongCount: 0 }),
    ];

    for (const item of cases) {
      const { weight } = calculateReviewPriority(item, NOW);
      assert.ok(Number.isFinite(weight), `wordId ${item.wordId} 权重不是有限数`);
      assert.ok(weight > 0, `wordId ${item.wordId} 权重不大于 0`);
      assert.ok(!Number.isNaN(weight), `wordId ${item.wordId} 权重是 NaN`);
    }
  });

  it("⑩ 时间为 null → 不崩溃，权重仍然健康", () => {
    const noTimes = calculateReviewPriority(
      candidate({ lastReviewTime: null, nextReviewTime: null }),
      NOW,
    );
    assert.ok(Number.isFinite(noTimes.weight) && noTimes.weight > 0);
    assert.equal(noTimes.overdueRatio, 0, "没有下次时间就当没逾期");
    assert.equal(noTimes.retention, 0, "没复习过 → 保持率按 0 处理（防御）");

    // 只有一边是 null 的四种组合都要安全
    for (const override of [
      { lastReviewTime: null },
      { nextReviewTime: null },
      { lastReviewTime: "不是时间" },
      { nextReviewTime: "不是时间" },
    ]) {
      const priority = calculateReviewPriority(candidate(override), NOW);
      assert.ok(Number.isFinite(priority.weight) && priority.weight > 0);
      assert.ok(Number.isFinite(priority.retention));
      assert.ok(Number.isFinite(priority.overdueRatio));
      assert.ok(Number.isFinite(priority.rawOverdueRatio));
    }
  });

  it("⑪ last_review_time >= next_review_time → 不 NaN、不除零", () => {
    const same = calculateReviewPriority(
      candidate({
        lastReviewTime: NOW.toISOString(),
        nextReviewTime: NOW.toISOString(),
      }),
      NOW,
    );
    assert.ok(Number.isFinite(same.weight) && same.weight > 0);

    const reversed = calculateReviewPriority(
      candidate({
        lastReviewTime: NOW.toISOString(),
        nextReviewTime: new Date(NOW.getTime() - DAY).toISOString(),
      }),
      NOW,
    );
    assert.ok(Number.isFinite(reversed.weight) && reversed.weight > 0);
    assert.ok(Number.isFinite(reversed.overdueRatio));
    assert.ok(reversed.overdueRatio <= MAX_OVERDUE_RATIO);
  });

  it("⑪补 间隔非法时回退到兜底间隔", () => {
    assert.equal(
      plannedIntervalMs({ ...candidate(), lastReviewTime: null }),
      FALLBACK_INTERVAL_MS,
    );
    assert.equal(
      plannedIntervalMs({
        ...candidate(),
        lastReviewTime: NOW.toISOString(),
        nextReviewTime: NOW.toISOString(),
      }),
      FALLBACK_INTERVAL_MS,
      "间隔为 0 要回退，不能除零",
    );
  });

  it("⑫ 新词（没有任何进度）不会产生异常", () => {
    const newWord = calculateReviewPriority(
      {
        wordId: 999,
        lastReviewTime: null,
        nextReviewTime: null,
        reviewCount: 0,
        correctCount: 0,
        wrongCount: 0,
        stars: 3,
      },
      NOW,
    );

    assert.ok(Number.isFinite(newWord.weight) && newWord.weight > 0);
    assert.equal(newWord.errorRate, 0.5, "平滑后新词错误率是 50%，不是 0 或 100");
  });

  it("极端数据（负次数、超大星级）也不会产生异常权重", () => {
    const priority = calculateReviewPriority(
      candidate({ reviewCount: -10, wrongCount: -3, stars: 999 }),
      NOW,
    );
    assert.ok(Number.isFinite(priority.weight) && priority.weight > 0);
    assert.ok(priority.errorRate >= 0 && priority.errorRate <= 1);
    assert.equal(priority.masteryFactor, 1, "星级超过 5 按 5 算");
  });
});

/* ══════════════════════════════════════════════════════════
 * 16：不重复
 * ══════════════════════════════════════════════════════════ */

describe("加权抽样：不重复、不丢词", () => {
  it("十六 排完序后每个候选词恰好出现一次", () => {
    const input = Array.from({ length: 25 }, (_unused, index) =>
      candidate({ wordId: index + 1 }),
    );
    const ranked = rankReviewCandidates(input, NOW, "user-a|2026-10-21");

    assert.equal(ranked.length, input.length, "不能多也不能少");

    const ids = ranked.map((item) => item.candidate.wordId);
    assert.equal(new Set(ids).size, ids.length, "不能有重复");
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      input.map((item) => item.wordId).sort((a, b) => a - b),
    );
  });

  it("空集合不报错", () => {
    assert.deepEqual(rankReviewCandidates([], NOW, "user-a"), []);
  });

  it("加权键：权重越大越接近 1", () => {
    const u = 0.5;
    const low = weightedShuffleKey(0.1, u);
    const high = weightedShuffleKey(5, u);

    assert.ok(high > low, `权重 5 的键 ${high} 应该大于权重 0.1 的键 ${low}`);
    assert.ok(high <= 1 && low >= 0);
  });

  it("归一化后的概率加起来是 1", () => {
    const priorities = [0.5, 1, 2].map((stars) => ({
      ...calculateReviewPriority(candidate({ stars }), NOW),
    }));
    const probs = normalizeWeights(priorities);

    const sum = probs.reduce((total, value) => total + value, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `概率和应为 1，实际 ${sum}`);
  });

  it("权重全为 0 等异常情况也能归一化（不产生 NaN）", () => {
    const probs = normalizeWeights([
      { weight: 0 } as never,
      { weight: 0 } as never,
    ]);
    assert.deepEqual(probs, [0.5, 0.5]);
  });
});

/* ══════════════════════════════════════════════════════════
 * 17：饿死保护
 * ══════════════════════════════════════════════════════════ */

describe("饿死保护：严重逾期的词必须排前面", () => {
  it("十七 严重逾期的词即使权重更低，也排在普通词前面", () => {
    const starving = candidate({
      wordId: 1,
      // 计划 1 天，逾期 5 天 → 逾期比 5 > 2
      lastReviewTime: new Date(NOW.getTime() - 6 * DAY).toISOString(),
      nextReviewTime: new Date(NOW.getTime() - 5 * DAY).toISOString(),
      // 刻意让它「看起来很熟」：满星、从没答错
      stars: 5,
      reviewCount: 50,
      correctCount: 50,
      wrongCount: 0,
    });

    const fresh = candidate({
      wordId: 2,
      // 刚复习完
      lastReviewTime: NOW.toISOString(),
      nextReviewTime: new Date(NOW.getTime() + DAY).toISOString(),
      // 刻意让它「看起来很糟」：0 星、错很多
      stars: 0,
      reviewCount: 10,
      wrongCount: 10,
      correctCount: 0,
    });

    const ranked = rankReviewCandidates([fresh, starving], NOW, "user-a|2026-10-21");

    assert.equal(
      ranked[0].candidate.wordId,
      1,
      "严重逾期的必须排第一，不能被概率饿死",
    );
    assert.equal(ranked[0].priority.starving, true);
    assert.equal(ranked[1].priority.starving, false);
  });

  it("逾期倍数正好等于门槛时还不算 starving（要严格大于）", () => {
    const priority = calculateReviewPriority(
      candidate({
        lastReviewTime: new Date(NOW.getTime() - (1 + STARVATION_OVERDUE_RATIO) * DAY).toISOString(),
        nextReviewTime: new Date(NOW.getTime() - STARVATION_OVERDUE_RATIO * DAY).toISOString(),
      }),
      NOW,
    );

    assert.equal(priority.starving, false);
  });

  it("多个 starving 词之间仍然按权重排", () => {
    const a = candidate({
      wordId: 1,
      lastReviewTime: new Date(NOW.getTime() - 8 * DAY).toISOString(),
      nextReviewTime: new Date(NOW.getTime() - 7 * DAY).toISOString(),
      reviewCount: 10,
      wrongCount: 0,
      stars: 5,
    });
    const b = candidate({
      wordId: 2,
      lastReviewTime: new Date(NOW.getTime() - 8 * DAY).toISOString(),
      nextReviewTime: new Date(NOW.getTime() - 7 * DAY).toISOString(),
      reviewCount: 10,
      wrongCount: 10,
      stars: 0,
    });

    const ranked = rankReviewCandidates([a, b], NOW, "user-a|2026-10-21");
    assert.equal(ranked.length, 2);
    assert.ok(ranked.every((item) => item.priority.starving));
    // 分数表：b（错得多、0 星）权重更高，所以更容易排前面
    assert.equal(ranked[0].candidate.wordId, 2);
  });
});

/* ══════════════════════════════════════════════════════════
 * 词频接口：现在必须是 1，将来能接上
 * ══════════════════════════════════════════════════════════ */

describe("真题词频：现在没有数据，因子必须是 1", () => {
  it("没有词频时不改变权重", () => {
    assert.equal(frequencyFactorOf(undefined), 1);
    assert.equal(frequencyFactorOf(null), 1);

    const withoutScore = weightOf();
    const withUndefined = weightOf({ frequencyScore: undefined });
    assert.equal(withoutScore, withUndefined);
  });

  it("有词频时只是温和修正（0.8 ~ 1.2）", () => {
    assert.ok(Math.abs(frequencyFactorOf(0) - 0.8) < 1e-9);
    assert.ok(Math.abs(frequencyFactorOf(0.5) - 1) < 1e-9);
    assert.ok(Math.abs(frequencyFactorOf(1) - 1.2) < 1e-9);
  });

  it("词频超出 0~1 会被夹住，不会让权重飞起来", () => {
    // 注意用容差比较：1 - 0.2 + 0.4 在浮点里是 1.2000000000000002
    assert.ok(Math.abs(frequencyFactorOf(99) - 1.2) < 1e-9);
    assert.ok(Math.abs(frequencyFactorOf(-99) - 0.8) < 1e-9);
  });

  it("高频词不会因为词频就盖过遗忘概率", () => {
    const highFrequencyButFresh = weightOf({
      frequencyScore: 1,
      lastReviewTime: NOW.toISOString(),
      nextReviewTime: new Date(NOW.getTime() + DAY).toISOString(),
    });
    const neverSeenButDue = weightOf({
      frequencyScore: 0,
      lastReviewTime: new Date(NOW.getTime() - 10 * DAY).toISOString(),
      nextReviewTime: new Date(NOW.getTime() - 9 * DAY).toISOString(),
    });

    assert.ok(
      neverSeenButDue > highFrequencyButFresh,
      "快忘的词必须高于「高频但刚复习完」的词",
    );
  });
});

/* ══════════════════════════════════════════════════════════
 * 和已有功能的配合：概率排序之后，resume 仍然有效
 * ══════════════════════════════════════════════════════════ */

describe("概率排序 + 上次停留的词（resume）", () => {
  it("十五 概率排序之后，moveResumeWordFirst 仍然能把那个词提到队首", () => {
    /*
     * getStudyQueue 的最终顺序是：
     *   概率排序 → 再把 resume cookie 里那个词提到第一位
     * 这条测试证明后一步没有被概率排序破坏 ——
     * 「退出去是 book，回来还是 book」必须继续成立。
     */
    const batch = Array.from({ length: 10 }, (_unused, index) =>
      candidate({ wordId: index + 1 }),
    );
    const ranked = rankReviewCandidates(batch, NOW, "user-a|2026-10-21");
    const entries = ranked.map((item) => ({
      word: { id: item.candidate.wordId },
      isNew: false,
    }));

    // 随便挑一个「本来排在最后」的词当作上次停留的位置
    const target = entries[entries.length - 1].word.id;
    assert.notEqual(entries[0].word.id, target, "前提：它本来不在第一位");

    const final = moveResumeWordFirst(entries, target);

    assert.equal(final[0].word.id, target, "resume 之后它必须在第一位");
    assert.equal(final.length, entries.length, "不能多也不能少");
    assert.equal(new Set(final.map((item) => item.word.id)).size, final.length);
  });

  it("resume 找不到那个词时（已答完/被静默）顺序保持不变", () => {
    const batch = Array.from({ length: 5 }, (_unused, index) =>
      candidate({ wordId: index + 1 }),
    );
    const ranked = rankReviewCandidates(batch, NOW, "user-a|2026-10-21");
    const entries = ranked.map((item) => ({ word: { id: item.candidate.wordId } }));
    const before = entries.map((item) => item.word.id);

    const final = moveResumeWordFirst(entries, 9999);
    assert.deepEqual(final.map((item) => item.word.id), before);
  });
});

/* ══════════════════════════════════════════════════════════
 * 参数自检：防止以后误改到离谱
 * ══════════════════════════════════════════════════════════ */

describe("参数合理性", () => {
  it("目标保持率在 (0,1) 区间", () => {
    assert.ok(TARGET_RETENTION > 0 && TARGET_RETENTION < 1);
  });

  it("基础权重是小的正数（不能是 0，否则熟练词的权重会归零）", () => {
    assert.ok(BASE_WEIGHT > 0 && BASE_WEIGHT < 1);
  });

  it("遗忘指数 > 1（放大快忘的差异）", () => {
    assert.ok(FORGETTING_POWER > 1);
  });

  it("逾期比上限是正数且不至于过大", () => {
    assert.ok(MAX_OVERDUE_RATIO > 0 && MAX_OVERDUE_RATIO <= 5);
  });
});
