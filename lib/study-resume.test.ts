/**
 * 「上次停在这个词」的自动测试。
 *
 * 用户的原话：「我希望我退出去是哪个单词回来就还是哪个，
 * 比如退出去是 book 回来还是 book」。
 *
 * 这个功能的逻辑很薄，但边界不少：找不到怎么办、本来就在第一位怎么办、
 * 同一个词出现两次怎么办 —— 这些都会被下面钉住。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  moveResumeWordFirst,
  RESUME_COOKIE,
  RESUME_COOKIE_MAX_AGE_SECONDS,
} from "./study-resume";

/** 造一个最小的队列项 */
function entry(id: number) {
  return { word: { id }, isNew: false };
}

/** 把队列里的 id 抽出来比对，比整个对象好读 */
function ids(entries: Array<{ word: { id: number } }>): number[] {
  return entries.map((item) => item.word.id);
}

describe("moveResumeWordFirst：把上次停的词挪到最前面", () => {
  it("词在中间 → 挪到第一位，其余顺序不变", () => {
    const queue = [entry(1), entry(2), entry(3), entry(4), entry(5)];
    const result = moveResumeWordFirst(queue, 3);

    assert.deepEqual(ids(result), [3, 1, 2, 4, 5]);
  });

  it("词在最后 → 也是挪到第一位", () => {
    const queue = [entry(1), entry(2), entry(3)];
    assert.deepEqual(ids(moveResumeWordFirst(queue, 3)), [3, 1, 2]);
  });

  it("词本来就在第一位 → 队列完全不变", () => {
    const queue = [entry(1), entry(2), entry(3)];
    assert.deepEqual(ids(moveResumeWordFirst(queue, 1)), [1, 2, 3]);
  });

  it("找不到这个词 → 队列完全不变（不能报错、也不能乱插）", () => {
    const queue = [entry(1), entry(2)];
    assert.deepEqual(
      ids(moveResumeWordFirst(queue, 999)),
      [1, 2],
      "这个词可能已经答完、或者被静默了，保持原样即可",
    );
  });

  it("没有记录（null）→ 队列完全不变", () => {
    const queue = [entry(1), entry(2)];
    assert.deepEqual(ids(moveResumeWordFirst(queue, null)), [1, 2]);
  });

  it("空队列不报错", () => {
    assert.deepEqual(moveResumeWordFirst([], 5), []);
    assert.deepEqual(moveResumeWordFirst([], null), []);
  });

  it("同一个词在队列里出现两次（本轮重排）→ 只挪第一个", () => {
    // 短间隔的词会被重新排进队尾，所以队列里可能有重复
    const queue = [entry(1), entry(2), entry(3), entry(2)];
    const result = moveResumeWordFirst(queue, 2);

    assert.deepEqual(ids(result), [2, 1, 3, 2]);
    assert.equal(result.length, 4, "不能凭空多出或少掉元素");
  });

  it("不改动原数组（纯函数，不能有副作用）", () => {
    const queue = [entry(1), entry(2), entry(3)];
    moveResumeWordFirst(queue, 3);
    assert.deepEqual(ids(queue), [1, 2, 3], "原队列必须原封不动");
  });

  it("元素数量和内容都不丢", () => {
    const queue = [entry(1), entry(2), entry(3), entry(4)];
    const result = moveResumeWordFirst(queue, 4);

    assert.equal(result.length, queue.length);
    assert.deepEqual([...ids(result)].sort((a, b) => a - b), [1, 2, 3, 4]);
  });
});

describe("cookie 常量", () => {
  it("cookie 名字稳定（改了会让所有人的记录失效，得是有意为之）", () => {
    assert.equal(RESUME_COOKIE, "study_resume");
  });

  it("有效期是 30 天左右，不会立刻过期", () => {
    const days = RESUME_COOKIE_MAX_AGE_SECONDS / 86400;
    assert.ok(days >= 7, "太短的话第二天回来就丢了");
    assert.ok(days <= 365, "太长没必要");
  });
});
