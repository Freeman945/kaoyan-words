/**
 * 「需要重点关注的单词」判定的自动测试。
 *
 * 这个功能决定「导出的清单里有哪些词」。判定错了，你拿到的是一份
 * 无关紧要的词表 —— 比没有更糟，因为它会让你以为自己在盯重点。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENTION_CSV_HEADER,
  buildAttentionCsv,
  clampExportDays,
  CONSECUTIVE_FAILS,
  formatCsvTime,
  judgeAttention,
  LOW_STAR_TIMES,
  MAX_EXPORT_DAYS,
  MIN_EXPORT_DAYS,
  type AttentionInput,
  type AttentionLog,
} from "./attention-export";

/** 造一条流水 */
function log(rating: AttentionLog["rating"], at: string): AttentionLog {
  return { rating, reviewed_at: at };
}

/** 造一份输入 */
function input(
  logs: AttentionLog[],
  correctCount: number,
  wrongCount: number,
): AttentionInput {
  return {
    word: { word: "meet", phonetic: "[mi:t]", meaning: "遇见" },
    correctCount,
    wrongCount,
    logs,
  };
}

describe("没有作答记录", () => {
  it("窗口内没答过这个词 → 不算需要关注", () => {
    const verdict = judgeAttention(input([], 3, 1));

    assert.equal(verdict.needsAttention, false);
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.windowAttempts, 0);
    assert.equal(verdict.lastRatedAt, null);
  });
});

describe("标准 ①：连续三次不认识 / 模糊", () => {
  it("最近 3 次都是「不认识」→ 命中", () => {
    const verdict = judgeAttention(
      input(
        [log("again", "2026-10-18T10:00:00Z"), log("again", "2026-10-18T10:01:00Z"), log("again", "2026-10-18T10:02:00Z")],
        2,
        3,
      ),
    );

    assert.equal(verdict.needsAttention, true);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes("连续 3 次")),
      `实际原因：${verdict.reasons.join("、")}`,
    );
  });

  it("「不认识」和「模糊」混合也算（都算没答好）", () => {
    const verdict = judgeAttention(
      input(
        [log("again", "2026-10-18T10:00:00Z"), log("hard", "2026-10-18T10:01:00Z"), log("hard", "2026-10-18T10:02:00Z")],
        2,
        1,
      ),
    );

    assert.equal(verdict.needsAttention, true);
  });

  it("只连续 2 次 → 不命中", () => {
    const verdict = judgeAttention(
      input([log("again", "2026-10-18T10:00:00Z"), log("hard", "2026-10-18T10:01:00Z")], 2, 2),
    );

    assert.equal(verdict.needsAttention, false);
  });

  it("中间夹了一次「认识」→ 不命中（连续被打断了）", () => {
    const verdict = judgeAttention(
      input(
        [
          log("again", "2026-10-18T10:00:00Z"),
          log("again", "2026-10-18T10:01:00Z"),
          log("good", "2026-10-18T10:02:00Z"),
          log("again", "2026-10-18T10:03:00Z"),
          log("again", "2026-10-18T10:04:00Z"),
        ],
        5,
        4,
      ),
    );

    assert.equal(
      verdict.needsAttention,
      false,
      "最近两次是错的，但前面有过「认识」，不算连续三次",
    );
  });

  it("只看最近 3 次，更早的错不影响判定", () => {
    const verdict = judgeAttention(
      input(
        [
          log("again", "2026-10-18T10:00:00Z"),
          log("good", "2026-10-18T10:01:00Z"),
          log("good", "2026-10-18T10:02:00Z"),
          log("good", "2026-10-18T10:03:00Z"),
        ],
        5,
        1,
      ),
    );

    assert.equal(verdict.needsAttention, false);
  });

  it("刚好 3 次（门槛本身）就算", () => {
    assert.equal(CONSECUTIVE_FAILS, 3);
  });
});

describe("标准 ②：五次低于四星", () => {
  it("5 次作答后星级都不到 4 颗 → 命中", () => {
    /*
     * 反推：当前答对 2、答错 8；窗口内 5 次都是「不认识」
     *   窗口开始时的答错 = 8 − 5 = 3，答对 2
     *       星级 = 3 + 2 − 3 = 2
     *   之后每答错一次星级依次变成 1、0、0、0、0
     *   → 5 次都低于 4 颗 ✓
     */
    const verdict = judgeAttention(
      input(
        [
          log("again", "2026-10-18T10:00:00Z"),
          log("again", "2026-10-18T10:01:00Z"),
          log("again", "2026-10-18T10:02:00Z"),
          log("again", "2026-10-18T10:03:00Z"),
          log("again", "2026-10-18T10:04:00Z"),
        ],
        2,
        8,
      ),
    );

    assert.ok(
      verdict.reasons.some((reason) => reason.includes("低于 4 星")),
      `实际原因：${verdict.reasons.join("、")}`,
    );
  });

  it("只有 4 次低于四星 → 不命中（而且要让标准①不成立）", () => {
    /*
     * 构造要小心：如果窗口里全是「不认识」，标准①（连续 3 次）也会命中，
     * 就测不到标准②了。所以最后放一次「认识」把连续打断。
     *
     * 当前答对 1、答错 4；窗口内 3 次不认识 + 1 次认识
     *   窗口开始：答对 0，答错 1 → 星级 2
     *   之后星级依次：1、0、0、0  → 4 次低于 4 颗
     *   连续判定：最近 3 次是 [不认识, 不认识, 认识] → 不连续 ✗
     * → 两条标准都不满足
     */
    const verdict = judgeAttention(
      input(
        [
          log("again", "2026-10-18T10:00:00Z"),
          log("again", "2026-10-18T10:01:00Z"),
          log("again", "2026-10-18T10:02:00Z"),
          log("good", "2026-10-18T10:03:00Z"),
        ],
        1,
        4,
      ),
    );

    assert.equal(verdict.needsAttention, false);
    assert.equal(verdict.reasons.length, 0);
  });

  it("门槛就是 5 次", () => {
    assert.equal(LOW_STAR_TIMES, 5);
  });
});

describe("反推起点：星级要算对", () => {
  it("利用历史总计反推出窗口开始时的星级，再逐次重放", () => {
    /*
     * 当前答对 5、答错 4；窗口内 1 次「不认识」+ 1 次「认识」
     *   窗口开始：答对 5−1=4，答错 4−1=3   → 星级 3+4−3 = 4
     *   作答「不认识」：答错 4 → 3+4−4 = 3
     *   作答「认识」：  答对 5 → 3+5−4 = 4
     * → 最终星级应该是 4
     */
    const verdict = judgeAttention(
      input(
        [log("again", "2026-10-18T10:00:00Z"), log("good", "2026-10-18T10:01:00Z")],
        5,
        4,
      ),
    );

    assert.equal(verdict.stars, 4);
  });

  it("星级不会超过 5，也不会低于 0", () => {
    const high = judgeAttention(
      input([log("good", "2026-10-18T10:00:00Z")], 50, 0),
    );
    assert.equal(high.stars, 5);

    const low = judgeAttention(
      input([log("again", "2026-10-18T10:00:00Z")], 0, 50),
    );
    assert.equal(low.stars, 0);
  });

  it("总计比窗口内次数还少时（数据不一致）从初始状态开始，不报错、不出负数", () => {
    const verdict = judgeAttention(
      input([log("again", "2026-10-18T10:00:00Z"), log("again", "2026-10-18T10:01:00Z")], 0, 1),
    );

    assert.ok(verdict.stars >= 0 && verdict.stars <= 5);
  });
});

describe("两条标准同时满足", () => {
  it("两个原因都会写进去", () => {
    const verdict = judgeAttention(
      input(
        [
          log("again", "2026-10-18T10:00:00Z"),
          log("again", "2026-10-18T10:01:00Z"),
          log("again", "2026-10-18T10:02:00Z"),
          log("again", "2026-10-18T10:03:00Z"),
          log("again", "2026-10-18T10:04:00Z"),
        ],
        2,
        8,
      ),
    );

    assert.equal(verdict.needsAttention, true);
    assert.ok(verdict.reasons.length >= 2, `实际原因：${verdict.reasons.join("、")}`);
    assert.equal(verdict.windowAttempts, 5);
    assert.equal(verdict.lastRatedAt, "2026-10-18T10:04:00Z");
  });
});

describe("时间范围的天数要夹到 1~30", () => {
  it("正常值不变", () => {
    assert.equal(clampExportDays(7), 7);
  });

  it("太小取 1，太大取 30", () => {
    assert.equal(clampExportDays(0), MIN_EXPORT_DAYS);
    assert.equal(clampExportDays(-5), MIN_EXPORT_DAYS);
    assert.equal(clampExportDays(99999), MAX_EXPORT_DAYS);
  });

  it("小数四舍五入", () => {
    assert.equal(clampExportDays(6.4), 6);
    assert.equal(clampExportDays(6.6), 7);
  });

  it("不是数字时给个默认值，不能崩", () => {
    assert.equal(clampExportDays(Number.NaN), 7);
    assert.equal(clampExportDays(Number.POSITIVE_INFINITY), 7);
  });
});

describe("CSV 导出", () => {
  it("开头有 BOM（否则 Excel 打开中文乱码）", () => {
    const csv = buildAttentionCsv([]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
  });

  it("表头是中文那几列", () => {
    const csv = buildAttentionCsv([]);
    assert.ok(csv.includes(ATTENTION_CSV_HEADER.join(",")));
  });

  it("一行数据能正常拼出来", () => {
    const csv = buildAttentionCsv([
      {
        word: "meet",
        phonetic: "[mi:t]",
        meaning: "遇见",
        stars: 2,
        windowAttempts: 5,
        lastRatedAt: "2026-10-18T10:04:00Z",
        reasons: ["连续 3 次不认识/模糊"],
      },
    ]);

    assert.ok(csv.includes("meet"));
    assert.ok(csv.includes("遇见"));
    assert.ok(csv.includes("连续 3 次不认识/模糊"));
  });

  it("含逗号、引号的字段会正确转义", () => {
    const csv = buildAttentionCsv([
      {
        word: 'say "hi"',
        phonetic: null,
        meaning: "说，讲",
        stars: 1,
        windowAttempts: 3,
        lastRatedAt: null,
        reasons: ["a", "b"],
      },
    ]);

    // 释义里的中文逗号不是 CSV 分隔符，不需要转义；但英文逗号需要
    assert.ok(csv.includes('"say ""hi"""'), "引号要成对转义");
    assert.ok(csv.includes("a；b"), "多个原因用分号连接");
  });

  it("没有音标 / 没有时间时留空，不写 null 或 undefined", () => {
    const csv = buildAttentionCsv([
      {
        word: "x",
        phonetic: null,
        meaning: "某物",
        stars: 3,
        windowAttempts: 1,
        lastRatedAt: null,
        reasons: [],
      },
    ]);

    assert.ok(!csv.includes("null"));
    assert.ok(!csv.includes("undefined"));
  });

  it("时间格式化成本地好读的样子", () => {
    const text = formatCsvTime("2026-10-18T10:04:00Z");
    // 北京时间 = UTC+8，所以应该是 18:04
    assert.equal(text, "2026-10-18 18:04");
  });

  it("时间无效或为空时返回空字符串", () => {
    assert.equal(formatCsvTime(null), "");
    assert.equal(formatCsvTime("不是时间"), "");
  });
});
