"use server";

/**
 * 登录 / 注册 / 退出 —— 三个「Server Action」（服务端动作）。
 *
 * 【什么是 Server Action】
 * 一个标了 "use server" 的函数，可以把「在服务器上执行」这件事，
 * 像普通函数一样直接从页面上调用。浏览器点提交时，Next.js 会把表单数据
 * 打包发给服务器，在这个函数里跑完，再把结果返回页面。
 *
 * 【为什么登录逻辑要放在服务器端，而不是浏览器里】
 * 因为登录成功后要写一个「登录 cookie」。浏览器里的 JS 虽然也能写 cookie，
 * 但只有服务端写的 cookie 才能设置 HttpOnly 属性 —— 这个属性让 JavaScript
 * 读不到 cookie 内容，能有效防止 XSS 攻击偷走登录状态。
 *
 * 注意：这个文件里的每个导出都必须是 async 函数（"use server" 的硬性要求），
 * 所以初始化状态 INITIAL_STATE 放在组件里定义，不放在这里。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { translateAuthError, validateCredentials } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/server";

/** 表单动作的结果：要么有错误，要么有提示信息，要么两个都没有 */
export type AuthFormState = {
  error: string | null;
  message: string | null;
};

/**
 * 只允许跳转到站内路径。
 *
 * 【为什么需要这个检查】
 * 登录页支持 ?next=/study 这样的参数，登录后跳回原来想去的页面。
 * 如果不加检查，坏人可以构造一个链接
 *   /login?next=https://钓鱼网站.com
 * 骗你登录后自动跳到假网站。这叫「开放重定向」漏洞。
 *
 * 规则：必须以单个 / 开头。这样 "//evil.com"（浏览器会当成完整网址）
 * 也会被拒掉。
 */
function safeRedirectPath(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

/** 登录 */
export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectPath(String(formData.get("next") ?? "/"));

  // 先在本地做基本检查，能省一次网络请求，提示也更具体
  const invalid = validateCredentials(email, password);
  if (invalid) {
    return { error: invalid, message: null };
  }

  const supabase = await createClient();

  // 把邮箱密码发给 Supabase Auth 验证。
  // 验证通过后，@supabase/ssr 会通过 server.ts 里的 setAll 把登录 cookie 写好。
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: translateAuthError(error.message), message: null };
  }

  // 告诉 Next.js：缓存过的页面作废，下次访问要重新渲染。
  // 不做这一步的话，首页可能还停留在「未登录」的旧版本。
  revalidatePath("/", "layout");

  // redirect 的实现方式是「抛出一个特殊的错误」，所以它后面的代码不会执行。
  // 注意：不要把它包在 try/catch 里，否则跳转会失效。
  redirect(next);
}

/** 注册 */
export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const invalid = validateCredentials(email, password);
  if (invalid) {
    return { error: invalid, message: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: translateAuthError(error.message), message: null };
  }

  // 【这里要分两种情况】
  // 如果 Supabase 项目开启了「邮箱验证」（默认是开的），signUp 会给你发一封
  // 确认邮件，并且 data.session 是 null —— 意思是「还没真正登录」。
  // 如果关掉了邮箱验证，signUp 会直接返回有效会话，人就等于登录好了。
  if (!data.session) {
    return {
      error: null,
      message:
        "注册成功！请去邮箱点一下确认链接，然后回来登录。" +
        "（如果一直收不到邮件，看 README 里「关掉邮箱验证」的说明。）",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/** 退出登录 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();

  // 这一步会让 Supabase 作废这次登录，并清掉本地登录 cookie
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
