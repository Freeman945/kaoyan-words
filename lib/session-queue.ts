/**
 * 本轮学习队列：重新排队的顺序，以及「到点之前不许出现」。
 *
 * ══════════════════════════════════════════════════════════════
 * 【解决什么问题】
 * 艾宾浩斯前三档是 1 / 5 / 15 分钟。原来的做法是「把词重新塞回队尾」，
 * 这只能保证「本轮里还会再出现」，**不能保证真的隔了那么久**。
 *
 * 队列短的时候问题很明显：只有 3 个词，你 20 秒就背完了，
 * 那个标着「5 分钟后」的词立刻又冒出来 —— 间隔根本没生效。
 *
 * 现在给重新排队的项加一个 eligibleAt（到点时间，来自 next_review_time）：
 *   只有 now >= eligibleAt 的词才允许出现。
 * ══════════════════════════════════════════════════════════════
 *
 * 【队列的不变式（非常重要，别破坏它）】
 *
 *   队列 = [ 正常词…（没有 eligibleAt，永远可作答）
 *            | 重新排队的词…（有 eligibleAt，按 eligibleAt 升序）]
 *
 * 也就是说：所有「未到点」的词一定排在所有正常词之后，
 * 而且它们之间是按时间先后排的。
 *
 * 有了这个不变式，「按顺序往前走，遇到第一个未到点的就结束本轮」
 * 就是正确的 —— 不会出现「跳过了一个到点的词」的情况。
 * ══════════════════════════════════════════════════════════════
 */

/** 任何带「到点时间」的队列项 */
export type Deferrable = {
  /**
   * 到这个毫秒时间戳之后才允许出现。
   * undefined = 没有限制（正常队列里的词）。
   */
  eligibleAt?: number;
};

/**
 * 这个项现在可以作答了吗？
 *
 * 没有 eligibleAt → 永远可以（正常队列）
 * 有 eligibleAt   → 必须到点
 */
export function isEligible(item: Deferrable, nowMs: number): boolean {
  if (item.eligibleAt === undefined) return true;
  if (!Number.isFinite(item.eligibleAt)) return true; // 数据坏了就放行，别把词卡死
  return nowMs >= item.eligibleAt;
}

/**
 * 把一个重新排队的项插进队列，**保持尾部按 eligibleAt 升序**。
 *
 * 为什么不用简单的 push：
 * 假设你先答了一个「15 分钟后」的词，又答了一个「1 分钟后」的词。
 * 直接 push 会让队列变成 [15分钟, 1分钟] —— 1 分钟那个会被 15 分钟的挡住，
 * 而「遇到第一个未到点就结束」的规则会让它永远出不来。
 * 按时间排序之后，先到点的先出现。
 */
export function insertDeferred<T extends Deferrable>(
  queue: readonly T[],
  item: T,
): T[] {
  const result = [...queue];

  if (item.eligibleAt === undefined) {
    result.push(item);
    return result;
  }

  // 找到第一个「比我更晚到点」的项，插在它前面
  const insertAt = result.findIndex(
    (existing) =>
      existing.eligibleAt !== undefined &&
      Number.isFinite(existing.eligibleAt) &&
      existing.eligibleAt > (item.eligibleAt as number),
  );

  if (insertAt === -1) result.push(item);
  else result.splice(insertAt, 0, item);

  return result;
}

/**
 * 从 from 开始，返回第一个现在可以作答的下标；没有就返回 -1。
 *
 * 依赖上面的不变式：未到点的词都在尾部且按时间升序，
 * 所以「第一个未到点」之后的所有词也都没到点，可以直接结束。
 */
export function nextPlayableIndex<T extends Deferrable>(
  queue: readonly T[],
  from: number,
  nowMs: number,
): number {
  if (from < 0 || from >= queue.length) return -1;
  return isEligible(queue[from], nowMs) ? from : -1;
}

/**
 * 统计 from 之后还有多少个「重新排队的词还没到点」。
 *
 * 只用于总结页的一句提示（「还有 3 个词会在几分钟后到期」），
 * 让用户知道本轮不是被凭空截断的。
 */
export function countWaiting<T extends Deferrable>(
  queue: readonly T[],
  from: number,
  nowMs: number,
): number {
  let count = 0;
  for (let index = Math.max(0, from); index < queue.length; index += 1) {
    if (!isEligible(queue[index], nowMs)) count += 1;
  }
  return count;
}
