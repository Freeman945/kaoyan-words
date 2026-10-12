/**
 * 服务端的登录状态查询。
 *
 * 为什么有了 proxy.ts 还要这个文件？
 * 因为 proxy.ts 只能做「粗筛」（你有没有登录），不能替代真正的权限检查。
 * 有个很重要的细节：Server Action（页面上的表单提交）是 POST 请求，
 * 如果某个路径被 matcher 排除了，那里的 Server Action 也会绕过 proxy。
 * 所以「每个需要登录的地方都自己再查一遍」才是可靠的做法。
 * 这叫纵深防御：不把安全押在单一一道门上。
 */
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * 取得当前登录用户；没登录（或还没配置数据库）返回 null。
 *
 * 为什么用 getUser() 而不是直接读 cookie？
 * cookie 存在用户自己的浏览器里，他是可以修改的。getUser() 会把令牌发给
 * Supabase Auth 服务器验证一次，返回的用户信息才可信。
 */
export async function getCurrentUser(): Promise<User | null> {
  // 还没填 .env.local 时，createClient() 会抛错。
  // 这里视为「未登录」，让页面去引导配置，而不是给用户一个 500 报错页。
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }
  return data.user;
}

/**
 * 要求必须登录。没登录就直接跳去登录页。
 *
 * 用法：在需要登录的页面开头写一行
 *   const user = await requireUser();
 * 之后 TypeScript 就知道 user 一定存在，不用再判断 null。
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
