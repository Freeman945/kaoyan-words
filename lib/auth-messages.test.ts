/**
 * 登录相关提示信息的自动测试。
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translateAuthError, validateCredentials } from "./auth-messages";

describe("translateAuthError：英文报错转中文", () => {
  it("密码错误给出明确提示", () => {
    assert.equal(
      translateAuthError("Invalid login credentials"),
      "邮箱或密码不正确。",
    );
  });

  it("邮箱未验证时告诉用户该去做什么", () => {
    const result = translateAuthError("Email not confirmed");
    assert.match(result, /邮箱还没验证/);
    assert.match(result, /点确认链接/, "提示里应该告诉用户具体动作");
  });

  it("原文带前缀时也能认出来（用包含匹配兜底）", () => {
    assert.equal(
      translateAuthError("AuthApiError: User already registered"),
      "这个邮箱已经注册过了，直接登录就行。",
    );
  });

  it("密码过短按前缀匹配", () => {
    assert.match(
      translateAuthError("Password should be at least 6 characters."),
      /密码太短/,
    );
  });

  it("没见过的报错保留原文，方便排查", () => {
    const result = translateAuthError("Some brand new error");
    assert.match(result, /Some brand new error/);
  });

  it("两头的空格会被忽略", () => {
    assert.equal(
      translateAuthError("  Invalid login credentials  "),
      "邮箱或密码不正确。",
    );
  });
});

describe("validateCredentials：提交前的本地检查", () => {
  it("邮箱和密码都合法时返回 null", () => {
    assert.equal(validateCredentials("me@example.com", "123456"), null);
  });

  it("邮箱为空时提示填写邮箱", () => {
    assert.equal(validateCredentials("", "123456"), "请填写邮箱。");
  });

  it("密码为空时提示填写密码", () => {
    assert.equal(validateCredentials("me@example.com", ""), "请填写密码。");
  });

  it("邮箱缺少 @ 时提示格式不对", () => {
    assert.match(
      String(validateCredentials("not-an-email", "123456")),
      /邮箱格式/,
    );
  });

  it("邮箱 @ 后面没有点号时提示格式不对", () => {
    assert.match(
      String(validateCredentials("me@example", "123456")),
      /邮箱格式/,
    );
  });

  it("密码不足 6 位时提示太短", () => {
    assert.match(String(validateCredentials("me@example.com", "12345")), /至少/);
  });

  it("刚好 6 位密码算合法（边界情况）", () => {
    assert.equal(validateCredentials("me@example.com", "123456"), null);
  });

  it("邮箱前后的空格会被自动忽略", () => {
    assert.equal(validateCredentials("  me@example.com  ", "123456"), null);
  });
});
