/**
 * Next.js 16 的「请求前置处理」入口文件。
 *
 * 文件名必须是 proxy.ts，函数名必须是 proxy，放在项目根目录。
 * 它只做一件事：把请求转交给 lib/supabase/proxy.ts 里的 updateSession。
 *
 * 为什么拆成两个文件？
 * proxy.ts 必须放在根目录且名字固定，而根目录应该保持干净。
 * 真正的逻辑放在 lib/ 下，和别的业务代码待在一起。
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

/**
 * matcher 决定「哪些请求要经过 proxy」。
 *
 * 这里用的是「排除法」：除了下面这些，其他请求都要经过。
 * 排除的是静态资源 —— 图片和 JS 文件不需要检查登录状态，
 * 每张图都跑一次会话刷新纯属浪费，会明显拖慢页面。
 */
export const config = {
  matcher: [
    /*
     * 排除以下路径：
     * - _next/static  打包出来的 JS/CSS
     * - _next/image   图片优化服务
     * - favicon.ico   网站图标
     * - 各种图片后缀（svg/png/jpg/jpeg/gif/webp）
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
