/**
 * 「上次停在这个词」—— 让退出再进来时回到原来那个词。
 *
 * ══════════════════════════════════════════════════════════════
 * 【用户的原话】
 * 「我希望我退出去是哪个单词回来就还是哪个，比如退出去是 book 回来还是 book」
 *
 * 【为什么光靠「不重复排刚答过的词」不够】
 * 之前加过一个 30 分钟保护期（见 RECENT_ANSWER_GRACE_MINUTES），
 * 它解决的是「刚答过的词不要跳回队伍最前面」。
 * 但你**当前正看着、还没作答**的那个词，队列里并没有任何记录说
 * 「就是它」—— 所以光靠算法推不出来，必须真的记下来。
 *
 * 【记在哪里：cookie，不是数据库】
 *   · 它只是一个界面位置（"我停在第几个词"），**不是学习进度** ——
 *     进度（复习次数、星级、下次时间）已经老老实实存在数据库里了。
 *   · 存 cookie 的好处是**服务端也读得到**，所以下次打开时服务器可以
 *     直接把这个词排到队列最前面，不用等页面加载完再跳。
 *   · 不用改数据库、不用跑 SQL。
 *
 * 代价：它是**按设备**记的。手机和电脑各自记各自的位置 ——
 * 这其实更合理：你在手机上背到哪，就接着手机那个位置。
 * ══════════════════════════════════════════════════════════════
 */

/** cookie 名字 */
export const RESUME_COOKIE = "study_resume";

/** cookie 有效期：30 天。超过就不必再记着了 */
export const RESUME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * 把「上次停在的那个词」挪到队列最前面。
 *
 * 抽成纯函数是为了能测：
 * 找不到 / 已经在第一位 / 在中间 / 重复出现，这几种情况都要对。
 *
 * @param entries 队列（每项至少有 { word: { id } }）
 * @param resumeId 上次停的词 id；没有就传 null
 */
export function moveResumeWordFirst<T extends { word: { id: number } }>(
  entries: T[],
  resumeId: number | null,
): T[] {
  if (resumeId === null) return entries;

  const at = entries.findIndex((entry) => entry.word.id === resumeId);
  // -1 = 这个词已经不在队列里了（比如已经答完、或者被静默了），保持原样
  // 0  = 本来就在第一位，不用动
  if (at <= 0) return entries;

  const result = [...entries];
  const [target] = result.splice(at, 1);
  result.unshift(target);
  return result;
}
