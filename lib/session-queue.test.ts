/**
 * 本轮队列的「到点才能出现」逻辑测试。
 *
 * 这一组测试守的是一个具体体验：
 * 一个标着「5 分钟后」的词，不该在 20 秒后又冒出来。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countWaiting,
  insertDeferred,
  isEligible,
  nextPlayableIndex,
  type Deferrable,
} from "./session-queue";

/** 造一个正常队列项（没有到点限制） */
function normal(id: number): Deferrable & { id: number } {
  return { id };
}

/** 造一个重新排队的项 */
function deferred(id: number, eligibleAt: number): Deferrable & { id: number } {
  return { id, eligibleAt };
}

const NOW = 1_000_000; // 毫秒时间戳，随便取一个

function ids(queue: Array<{ id: number }>): number[] {
  return queue.map((item) => item.id);
}

describe("isEligible：到点之前不许出现", () => {
  it("⑱ 没有 eligibleAt 的正常词永远可以作答", () => {
    assert.equal(isEligible(normal(1), NOW), true);
    assert.equal(isEligible(normal(1), 0), true);
  });

  it("⑱ eligibleAt 还没到 → 不能出现", () => {
    assert.equal(isEligible(deferred(1, NOW + 60_000), NOW), false);
  });

  it("⑲ 正好到点 → 可以出现（边界是闭区间）", () => {
    assert.equal(isEligible(deferred(1, NOW), NOW), true);
  });

  it("⑲ 已经过了很久 → 可以出现", () => {
    assert.equal(isEligible(deferred(1, NOW - 60_000), NOW), true);
  });

  it("eligibleAt 是坏数据（NaN/Infinity）时放行，不把词卡死", () => {
    /*
     * 取舍：坏数据一律「放行」而不是「永远不放行」。
     * 一个乱码的 eligibleAt 让词早出现几秒，代价很小；
     * 但如果解读成「永远不到点」，那个词会从本轮里彻底消失 —— 代价大得多。
     */
    assert.equal(isEligible({ eligibleAt: Number.NaN }, NOW), true);
    assert.equal(isEligible({ eligibleAt: Number.POSITIVE_INFINITY }, NOW), true);
    assert.equal(isEligible({ eligibleAt: Number.NEGATIVE_INFINITY }, NOW), true);
  });
});

describe("insertDeferred：保持尾部按到点时间升序", () => {
  it("正常词都排在重新排队的词前面", () => {
    const queue = insertDeferred(
      [normal(1), normal(2)],
      deferred(3, NOW + 60_000),
    );

    assert.deepEqual(ids(queue), [1, 2, 3]);
  });

  it("后答的「1 分钟」要插到先答的「15 分钟」前面", () => {
    /*
     * 这是关键：
     *   先答了 A（15 分钟后到点），再答了 B（1 分钟后到点）
     * 如果直接 push，队列是 [A(15分), B(1分)] —— B 会被 A 挡住。
     * 按时间排序后是 [B(1分), A(15分)]，B 先出现。
     */
    let queue: Array<Deferrable & { id: number }> = [normal(1)];
    queue = insertDeferred(queue, deferred(100, NOW + 15 * 60_000));
    queue = insertDeferred(queue, deferred(200, NOW + 1 * 60_000));

    assert.deepEqual(ids(queue), [1, 200, 100]);
  });

  it("连续插入多个，尾部始终升序", () => {
    let queue: Array<Deferrable & { id: number }> = [];
    queue = insertDeferred(queue, deferred(1, NOW + 30_000));
    queue = insertDeferred(queue, deferred(2, NOW + 10_000));
    queue = insertDeferred(queue, deferred(3, NOW + 20_000));
    queue = insertDeferred(queue, deferred(4, NOW + 5_000));

    assert.deepEqual(ids(queue), [4, 2, 3, 1]);

    const tail = queue.map((item) => item.eligibleAt as number);
    for (let i = 1; i < tail.length; i += 1) {
      assert.ok(tail[i] >= tail[i - 1], "尾部必须升序");
    }
  });

  it("不改动原数组（纯函数）", () => {
    const original = [normal(1)];
    insertDeferred(original, deferred(2, NOW + 1000));
    assert.deepEqual(ids(original), [1]);
  });

  it("没有 eligibleAt 的项按普通 push 处理", () => {
    const queue = insertDeferred([normal(1)], normal(2));
    assert.deepEqual(ids(queue), [1, 2]);
  });
});

describe("nextPlayableIndex：按顺序往前走，遇到没到点的就停", () => {
  it("下一个是正常词 → 可以继续", () => {
    assert.equal(nextPlayableIndex([normal(1), normal(2)], 1, NOW), 1);
  });

  it("⑱ 下一个是「5 分钟后」的词，而现在只过了 20 秒 → 返回 -1（不能提前出现）", () => {
    const queue = [normal(1), deferred(2, NOW + 5 * 60_000)];
    assert.equal(nextPlayableIndex(queue, 1, NOW), -1);

    // 20 秒后还是不行
    assert.equal(nextPlayableIndex(queue, 1, NOW + 20_000), -1);
  });

  it("⑲ 到点之后 → 可以继续", () => {
    const queue = [normal(1), deferred(2, NOW + 5 * 60_000)];
    assert.equal(nextPlayableIndex(queue, 1, NOW + 5 * 60_000), 1);
    assert.equal(nextPlayableIndex(queue, 1, NOW + 6 * 60_000), 1);
  });

  it("越界（已经背完）→ -1", () => {
    assert.equal(nextPlayableIndex([normal(1)], 1, NOW), -1);
    assert.equal(nextPlayableIndex([], 0, NOW), -1);
    assert.equal(nextPlayableIndex([normal(1)], -1, NOW), -1);
  });
});

describe("countWaiting：总结页要知道有多少词在等着", () => {
  it("统计 from 之后还没到点的数量", () => {
    const queue = [
      normal(1), // 0
      deferred(2, NOW + 60_000), // 1  未到点
      deferred(3, NOW + 120_000), // 2  未到点
    ];

    assert.equal(countWaiting(queue, 1, NOW), 2);
  });

  it("到点的那些不计入", () => {
    const queue = [deferred(1, NOW - 1000), deferred(2, NOW + 60_000)];
    assert.equal(countWaiting(queue, 0, NOW), 1);
  });

  it("没有等待项时是 0", () => {
    assert.equal(countWaiting([normal(1), normal(2)], 1, NOW), 0);
    assert.equal(countWaiting([], 0, NOW), 0);
  });
});

describe("整体行为：模拟一段短队列", () => {
  it("只有 3 个词时，5 分钟后的词不会被 20 秒后提前放出", () => {
    /*
     * 用户反馈过的问题：队列很短时，标着「5 分钟后」的词
     * 在几十秒后就又出现，等于间隔没生效。
     */
    const answeredAt = NOW;
    let queue: Array<Deferrable & { id: number }> = [normal(1), normal(2), normal(3)];

    // 背完 3 个词，第 1 个设成 1 分钟后、第 2 个设成 5 分钟后
    queue = insertDeferred(queue, deferred(1, answeredAt + 60_000));
    queue = insertDeferred(queue, deferred(2, answeredAt + 5 * 60_000));

    // 20 秒后：两个都还没到点 → 本轮结束（不强迫等待）
    assert.equal(nextPlayableIndex(queue, 3, answeredAt + 20_000), -1);
    assert.equal(countWaiting(queue, 3, answeredAt + 20_000), 2);

    // 1 分钟后：第 1 个到点了，可以出现
    assert.equal(nextPlayableIndex(queue, 3, answeredAt + 60_000), 3);

    // 5 分钟后：第 2 个也到点了
    assert.equal(nextPlayableIndex(queue, 4, answeredAt + 5 * 60_000), 4);
  });
});
