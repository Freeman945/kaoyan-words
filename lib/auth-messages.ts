/**
 * 把 Supabase 返回的英文错误，翻译成用户看得懂的中文。
 *
 * 为什么要单独做这件事？
 * Supabase 的报错原文是给开发者看的，比如 "Invalid login credentials"。
 * 直接显示给用户，他不知道自己该干什么。翻译后要说清「发生了什么」+
 * 「你该怎么做」。
 *
 * 这个文件也是纯函数，所以能被自动测试覆盖。
 */

/**
 * 常见错误对照表。
 * 左边是 Supabase 返回的英文片段，右边是给用户看的中文。
 */
const AUTH_ERROR_MAP: ReadonlyArray<readonly [string, string]> = [
  ["Invalid login credentials", "邮箱或密码不正确。"],
  ["Email not confirmed", "邮箱还没验证。请先去邮箱点确认链接，再回来登录。"],
  ["User already registered", "这个邮箱已经注册过了，直接登录就行。"],
  [
    "Password should be at least",
    "密码太短了，至少要 6 位（Supabase 的默认要求）。",
  ],
  [
    "Unable to validate email address",
    "邮箱格式不对，请检查有没有多打空格或漏掉 @。",
  ],
  [
    "Email rate limit exceeded",
    "验证邮件发得太频繁了。Supabase 免费版每小时只能发几封，" +
      "等一会儿再试，或者去控制台关掉邮箱验证。",
  ],
  [
    "For security purposes, you can only request this after",
    "出于安全限制，请稍等几十秒再重试。",
  ],
  ["Signups not allowed", "这个项目目前不允许新用户注册，请检查控制台设置。"],
  ["over_email_send_rate_limit", "验证邮件超过发送频率限制，请稍后再试。"],
  [
    "New password should be different",
    "新密码不能和旧密码相同。",
  ],
];

/**
 * 翻译一条 Supabase 错误信息。
 *
 * 先做完整匹配，再做「包含」匹配 —— 因为 Supabase 有时会在标准消息
 * 前面加一些上下文（例如 "AuthApiError: Invalid login credentials"）。
 *
 * 如果没找到对应翻译，就把原文附在后面返回。这样至少不会丢失线索，
 * 你去搜索或问我时还能看到原始报错。
 */
export function translateAuthError(message: string): string {
  const trimmed = message.trim();

  for (const [english, chinese] of AUTH_ERROR_MAP) {
    if (trimmed === english) return chinese;
  }

  for (const [english, chinese] of AUTH_ERROR_MAP) {
    if (trimmed.includes(english)) return chinese;
  }

  return `操作失败：${trimmed}`;
}

/**
 * 在把请求发给 Supabase 之前，先在本地做最基本的检查。
 *
 * 为什么要在本地先查一遍？
 * 一来省一次网络往返，二来能给出比 Supabase 更具体的中文提示
 * （Supabase 对格式错误的邮箱只会笼统地说一句 invalid format）。
 *
 * @returns 有问题的返回中文提示；没问题返回 null
 */
export function validateCredentials(
  email: string,
  password: string,
): string | null {
  const trimmedEmail = email.trim();

  if (trimmedEmail === "") {
    return "请填写邮箱。";
  }
  if (password === "") {
    return "请填写密码。";
  }

  // 只做最基本的形状检查：必须有 @，且 @ 前后都有内容，且后面有个点。
  // 不去写复杂的邮箱正则 —— 那种正则几乎都不正确，而且会误杀合法邮箱。
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  if (!looksLikeEmail) {
    return "邮箱格式看起来不对，请检查一下。";
  }

  // Supabase 默认要求密码至少 6 位。本地先拦一下，提示更清楚。
  if (password.length < 6) {
    return "密码太短了，至少要 6 位。";
  }

  return null;
}
