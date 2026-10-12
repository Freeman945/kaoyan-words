/**
 * 浏览器端 Supabase 客户端。
 *
 * 什么时候用：需要在「浏览器里」直接和 Supabase 说话时，比如登录页面
 * 里用户点了「登录」按钮，要把邮箱密码发给 Supabase Auth。
 *
 * 注意：这个文件顶部没有 "use client"，所以它本身既可以被客户端组件
 * 引用，也可以被服务端引用。但只要被客户端组件引用，整个文件就会进入
 * 浏览器包 —— 而这里用到的两个环境变量都是 NEXT_PUBLIC_ 开头的公开
 * 变量，所以是安全的。
 */
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseKey, getSupabaseUrl } from "@/lib/env";

/**
 * 创建一个浏览器端客户端。
 *
 * 注意这里是个函数，不是现成的对象 —— 每次调用都会新建一个。
 * 这是 @supabase/ssr 的官方建议：不要把它存到全局变量里复用。
 */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseKey());
}
