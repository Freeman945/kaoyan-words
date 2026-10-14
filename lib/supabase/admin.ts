/**
 * 「管理员客户端」—— 用 secret key 连接 Supabase。
 *
 * ⚠️ 这是本项目**唯一**一处绕过 RLS 的地方，所以说明写详细一些。
 *
 * 【为什么需要它】
 * 定时任务（晚上 10 点检查「今天学没学」）跑起来的时候没有用户登录态。
 * 而数据库的 RLS 规则是「只能读写自己的数据」，没有登录态就什么都读不到。
 * 要用 secret key 才能读到「所有用户今天学没学」。
 *
 * 【安全上的三条底线】
 *   1. 环境变量名**不带** NEXT_PUBLIC_ 前缀。
 *      带这个前缀的变量会在构建时被内联进浏览器代码，等于公开；
 *      不带前缀的只存在于服务器端。
 *   2. 这个文件只允许被服务端代码 import（Route Handler / Server Action）。
 *      绝不能出现在任何 "use client" 组件里。
 *   3. 拿不到密钥时**直接抛错**，绝不退化成「用公开密钥试一试」——
 *      那样只会得到一个莫名其妙的空结果，把问题藏起来。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/types/database";

export type AdminClient = SupabaseClient<Database>;

/** 管理员密钥配好了吗 */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

export function createAdminClient(): AdminClient {
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (secret === undefined || secret === "") {
    throw new Error(
      "没有配置 SUPABASE_SECRET_KEY，定时任务读不到数据。" +
        "去 Supabase 控制台 Settings → API Keys 复制 secret key，" +
        "加到 Vercel 的环境变量里。",
    );
  }

  return createClient<Database>(getSupabaseUrl(), secret, {
    // 定时任务没有「会话」这个概念，关掉这些功能
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
