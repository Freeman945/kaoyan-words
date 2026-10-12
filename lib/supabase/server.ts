/**
 * 服务端 Supabase 客户端。
 *
 * 什么时候用：在「服务端组件」、Server Action、Route Handler 里读写数据库。
 * 这是本项目的主力 —— 背单词的进度读写都会走这里，因为：
 *   1. 服务端才能安全地确认「当前登录的是谁」；
 *   2. 密钥和数据库操作不暴露给浏览器。
 *
 * 工作原理（重要）：
 * Supabase 的登录状态存在 cookie 里。这个客户端被创建时会绑定 Next.js 的
 * cookie 仓库，于是它发请求时会自动带上登录凭证 —— 所以数据库的
 * Row Level Security 能识别出「你是谁」，只让你读到自己的数据。
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseKey, getSupabaseUrl } from "@/lib/env";

/**
 * 创建一个服务端客户端。
 *
 * 关键：必须「每个请求新建一个」，不能缓存在模块级变量里。
 * 否则 A 用户的登录状态可能被 B 用户的请求复用 —— 这是严重的安全问题。
 */
export async function createClient() {
  // Next.js 16 中 cookies() 是异步的，必须 await
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseKey(), {
    cookies: {
      /** Supabase 需要读 cookie 时，从这里读 */
      getAll() {
        return cookieStore.getAll();
      },

      /**
       * Supabase 刷新了登录令牌、需要写新 cookie 时，会调用这里。
       *
       * 但 HTTP 规定：响应一旦开始发送，就不能再改 cookie 了。而「服务端
       * 组件」是在渲染过程中执行的，此时可能已经太晚，所以这里要用
       * try/catch 兜住。
       *
       * 真正负责刷新会话的是 proxy.ts（阶段 3 加入），它在渲染之前运行，
       * 时机是正确的。所以这里写失败可以安全忽略。
       */
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 在服务端组件里写 cookie 不被允许，交给 proxy.ts 处理即可
        }
      },
    },
  });
}
