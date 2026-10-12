/**
 * 会话刷新 + 访问控制。
 *
 * 这个文件由项目根目录的 proxy.ts 调用。它在「每一次请求」真正进入页面之前
 * 运行，是整个网站的门卫。
 *
 * 【Next.js 16 的重要变化 —— 你以后搜教程一定会踩这个坑】
 * Next.js 15 及以前，这个文件叫 middleware.ts，导出的函数叫 middleware。
 * Next.js 16 把它改名成了 proxy.ts / proxy。网上绝大多数 Supabase 教程
 * 还在写 middleware.ts —— 照抄的话代码不会报错，但完全不会执行，
 * 表现为「登录状态莫名其妙丢失」，极难排查。
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

/**
 * 不需要登录就能访问的页面。
 * - /login /register：还没登录的人当然要能打开
 * - /diagnostics：连接诊断页，配密钥阶段就要用，所以也必须能打开
 */
const PUBLIC_PATHS = ["/login", "/register", "/diagnostics"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(`${publicPath}/`),
  );
}

/**
 * 生成一个「跳转」响应，并把已刷新的登录 cookie 一起带上。
 *
 * 【为什么不能直接 NextResponse.redirect(...) 就完事】
 * 如果这次请求刚好触发了登录令牌刷新，新令牌已经写进了 supabaseResponse
 * 的 cookie 里。若我们直接返回一个新建的跳转响应，那些新 cookie 就丢了 ——
 * 浏览器还拿着旧令牌，下次请求又得再刷新一次，表现就是「随机掉登录」。
 * 所以必须把 cookie 搬过去。
 */
function redirectKeepingCookies(
  target: URL,
  source: NextResponse,
): NextResponse {
  const response = NextResponse.redirect(target);

  source.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  return response;
}

/**
 * 每个请求都会先走这里。
 *
 * 做两件事：
 *   1. 刷新登录令牌（这是它存在的主要理由）
 *   2. 没登录的人挡在门外，跳去登录页
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // 还没填 .env.local 时直接放行。
  // 否则网站每一页都会连不上 Supabase 而崩掉，连「去配置」的提示都看不到。
  if (!isSupabaseConfigured()) {
    return supabaseResponse;
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 第一步：把新 cookie 写回「本次请求」，让后面渲染页面时能读到新值
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        // 第二步：重建响应对象（cookie 变了，响应必须重建）
        supabaseResponse = NextResponse.next({ request });

        // 第三步：把新 cookie 写给浏览器，让它保存下来
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });

        // 第四步：带上缓存控制头。
        // 带登录凭证的响应绝对不能被 CDN 缓存 —— 否则可能把 A 的登录状态
        // 当成缓存发给 B。这是 @supabase/ssr 主动提供的安全头。
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // 【关键】在 createServerClient 和下面这行之间不要插入任何代码。
  // getClaims() 负责触发令牌刷新，它必须是紧随其后的第一个操作。
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { pathname } = request.nextUrl;

  // 情况一：没登录，却在访问需要登录的页面 → 挡去登录页
  if (!claims && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // 记住原本想去的页面，登录成功后直接送回去，不用手动再点一次
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return redirectKeepingCookies(loginUrl, supabaseResponse);
  }

  // 情况二：已经登录，却还去登录/注册页 → 送回首页
  if (claims && (pathname === "/login" || pathname === "/register")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return redirectKeepingCookies(homeUrl, supabaseResponse);
  }

  // 【关键】必须原样返回 supabaseResponse。
  // 不要在这里新建响应对象 —— 上面刷新出来的 cookie 会丢。
  return supabaseResponse;
}
