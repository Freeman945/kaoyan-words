/**
 * CSV 解析器的自动测试。
 *
 * CSV 看起来简单，但边界情况特别多。这些测试就是用来钉住那些
 * 「看起来没问题、实际会出错」的地方。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "./csv";

describe("parseCsv：基本解析", () => {
  it("按逗号切分普通行", () => {
    assert.deepEqual(parseCsv("a,b,c"), [["a", "b", "c"]]);
  });

  it("按换行切分多行", () => {
    assert.deepEqual(parseCsv("a,b\nc,d"), [
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("保留中文内容", () => {
    assert.deepEqual(parseCsv("word,释义\nabandon,放弃；抛弃"), [
      ["word", "释义"],
      ["abandon", "放弃；抛弃"],
    ]);
  });
});

describe("parseCsv：换行符处理", () => {
  it("Windows 的 \\r\\n 换行不会多出空字段", () => {
    assert.deepEqual(parseCsv("a,b\r\nc,d"), [
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("末尾有没有换行符，结果都一样", () => {
    assert.deepEqual(parseCsv("a,b\n"), parseCsv("a,b"));
  });

  it("末尾多个换行不会凭空多出数据行", () => {
    // 空行会产生 [""]，调用方负责跳过；这里只确认行数没被算错
    const rows = parseCsv("a,b\n\n");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], [""]);
  });
});

describe("parseCsv：引号处理（最容易出错的地方）", () => {
  it("引号内的逗号不算分隔符", () => {
    assert.deepEqual(parseCsv('a,"b,c",d'), [["a", "b,c", "d"]]);
  });

  it("连续两个双引号表示一个字面量双引号", () => {
    assert.deepEqual(parseCsv('a,"say ""hi""",c'), [["a", 'say "hi"', "c"]]);
  });

  it("引号内可以包含换行符", () => {
    assert.deepEqual(parseCsv('a,"line1\nline2",c'), [
      ["a", "line1\nline2", "c"],
    ]);
  });

  it("空字段被正确保留", () => {
    assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
  });

  it("引号包起来的空字段也是空字符串", () => {
    assert.deepEqual(parseCsv('a,"",c'), [["a", "", "c"]]);
  });
});

describe("parseCsv：BOM 处理", () => {
  it("开头的 BOM 被去掉（否则表头会变成 \\ufeffword）", () => {
    const rows = parseCsv("\ufeffword,meaning\nabandon,放弃");
    assert.equal(rows[0][0], "word", "第一个表头不应该带 BOM");
  });
});

describe("parseCsv：边界情况", () => {
  it("空字符串返回空数组", () => {
    assert.deepEqual(parseCsv(""), []);
  });

  it("只有一个字段的行也能解析", () => {
    assert.deepEqual(parseCsv("a"), [["a"]]);
  });

  it("真实词库的一整行能正确解析出 7 个字段", () => {
    const line =
      "abandon,/əˈbændən/,vt.,放弃；抛弃,Many researchers refuse to abandon it.,许多研究者拒绝放弃它。,2";
    const rows = parseCsv(line);
    assert.equal(rows[0].length, 7);
    assert.equal(rows[0][0], "abandon");
    assert.equal(rows[0][6], "2");
  });
});
