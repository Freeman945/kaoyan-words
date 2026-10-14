/**
 * 重点词排序的自动测试。
 *
 * 这套规则决定「首页会把哪几个词推到你面前」。规则错了，你每天看到的
 * 重点词就没意义 —— 所以它和复习算法一样值得钉住。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOCUS_SCORE_THRESHOLD,
  rankFocusWords,
  type FocusCandidate,
} from "./focus";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-12T10:00:00.000Z");

/** 造一个候选词，只写需要覆盖的字段 */
function candidate(
  word: string,
  progress: Partial<FocusCandidate["progress"]> = {},
): FocusCandidate {
  return {
    word: {
      id: Math.abs(word.length * 7919) % 100000,
      word,
      meaning: `${word} 的释义`,
      phonetic: `/${word}/`,
      part_of_speech: "n.",
    },
    progress: {
      familiarity: 0,
      consecutive_correct: 0,
      review_count: 1,
      correct_count: 1,
      wrong_count: 0,
      next_review_time: null,
      ...progress,
    },
  };
}

/** 造一个「N 天前就该复习」的时间 */
function overdueBy(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** 造一个「N 天后才复习」的时间 */
function dueIn(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

describe("哪些词不算重点词", () => {
  it("已经掌握、没逾期、没错过的词不会被列进来", () => {
    const result = rankFocusWords(
      [
        candidate("mastered", {
          familiarity: 3,
          consecutive_correct: 9,
          review_count: 10,
          correct_count: 10,
          wrong_count: 0,
          next_review_time: dueIn(20),
        }),
      ],
      NOW,
    );

    assert.equal(result.length, 0, "背熟的词不该占用重点词名额");
  });

  it("分数低于阈值的词会被过滤掉", () => {
    const weak = rankFocusWords(
      [candidate("fine", { familiarity: 2, next_review_time: dueIn(5) })],
      NOW,
    );
    assert.ok(
      weak.every((item) => item.score >= FOCUS_SCORE_THRESHOLD),
      "返回的每一项都应该达到阈值",
    );
  });
});

describe("排序：越需要关注的越靠前", () => {
  it("不认识的词排在模糊的前面", () => {
    const result = rankFocusWords(
      [
        candidate("blurry", { familiarity: 1, next_review_time: dueIn(1) }),
        candidate("unknown", { familiarity: 0, next_review_time: dueIn(1) }),
      ],
      NOW,
    );

    assert.equal(result[0].word.word, "unknown");
    assert.equal(result[1].word.word, "blurry");
  });

  it("错误率高的词会往上排", () => {
    const result = rankFocusWords(
      [
        candidate("clean", {
          familiarity: 1,
          review_count: 10,
          correct_count: 10,
          wrong_count: 0,
          next_review_time: dueIn(1),
        }),
        candidate("messy", {
          familiarity: 1,
          review_count: 10,
          correct_count: 2,
          wrong_count: 8,
          next_review_time: dueIn(1),
        }),
      ],
      NOW,
    );

    assert.equal(result[0].word.word, "messy", "错得多的应该排前面");
  });

  it("逾期越久排得越前（分数相同时按逾期天数）", () => {
    const result = rankFocusWords(
      [
        candidate("recent", { familiarity: 0, next_review_time: overdueBy(1) }),
        candidate("ancient", { familiarity: 0, next_review_time: overdueBy(10) }),
      ],
      NOW,
    );

    assert.equal(result[0].word.word, "ancient");
    assert.ok(result[0].overdueDays >= 10);
  });

  it("分数相同时按单词字母序，保证结果稳定（不会每次刷新都换顺序）", () => {
    const first = rankFocusWords(
      [
        candidate("zebra", { familiarity: 0, next_review_time: overdueBy(2) }),
        candidate("apple", { familiarity: 0, next_review_time: overdueBy(2) }),
      ],
      NOW,
    );
    const second = rankFocusWords(
      [
        candidate("apple", { familiarity: 0, next_review_time: overdueBy(2) }),
        candidate("zebra", { familiarity: 0, next_review_time: overdueBy(2) }),
      ],
      NOW,
    );

    assert.deepEqual(
      first.map((item) => item.word.word),
      second.map((item) => item.word.word),
      "输入顺序不同，输出顺序应该一致",
    );
    assert.deepEqual(
      first.map((item) => item.word.word),
      ["apple", "zebra"],
    );
  });
});

describe("原因说明：要让用户看懂为什么被挑中", () => {
  it("不认识的词说明是「还没记住」", () => {
    const result = rankFocusWords(
      [candidate("a", { familiarity: 0 })],
      NOW,
    );
    assert.ok(result[0].reasons.includes("还没记住"));
  });

  it("模糊的词说明是「总是模糊」", () => {
    const result = rankFocusWords(
      [candidate("a", { familiarity: 1 })],
      NOW,
    );
    assert.ok(result[0].reasons.includes("总是模糊"));
  });

  it("错误率过半时给出百分比", () => {
    const result = rankFocusWords(
      [
        candidate("a", {
          familiarity: 1,
          review_count: 4,
          correct_count: 1,
          wrong_count: 3,
        }),
      ],
      NOW,
    );
    assert.ok(
      result[0].reasons.some((reason) => reason.includes("错误率 75%")),
      `实际原因：${result[0].reasons.join("、")}`,
    );
  });

  it("累计答错多次会单独说明", () => {
    const result = rankFocusWords(
      [
        candidate("a", {
          familiarity: 1,
          review_count: 10,
          correct_count: 6,
          wrong_count: 4,
        }),
      ],
      NOW,
    );
    assert.ok(result[0].reasons.includes("累计答错 4 次"));
  });

  it("逾期会说明逾期了几天", () => {
    const result = rankFocusWords(
      [candidate("a", { familiarity: 0, next_review_time: overdueBy(3) })],
      NOW,
    );
    assert.ok(
      result[0].reasons.some((reason) => reason.includes("已逾期 3 天")),
      `实际原因：${result[0].reasons.join("、")}`,
    );
  });

  it("每个返回的词至少有一条原因说明", () => {
    const result = rankFocusWords(
      [
        candidate("a", { familiarity: 0 }),
        candidate("b", { familiarity: 1, wrong_count: 2, review_count: 3 }),
        candidate("c", { familiarity: 0, next_review_time: overdueBy(5) }),
      ],
      NOW,
    );

    for (const item of result) {
      assert.ok(
        item.reasons.length > 0,
        `${item.word.word} 没有给出任何原因`,
      );
    }
  });
});

describe("数量上限", () => {
  it("遵守 limit", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      candidate(`word${i}`, { familiarity: 0 }),
    );
    assert.equal(rankFocusWords(many, NOW, 5).length, 5);
    assert.equal(rankFocusWords(many, NOW, 20).length, 20);
  });

  it("候选词不够时有多少返回多少", () => {
    const result = rankFocusWords(
      [candidate("only", { familiarity: 0 })],
      NOW,
      20,
    );
    assert.equal(result.length, 1);
  });

  it("空列表返回空数组，不报错", () => {
    assert.deepEqual(rankFocusWords([], NOW), []);
  });
});
