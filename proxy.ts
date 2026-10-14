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
 * ══════════════════════════════════════════════════════════════
 * 这里用的是「排除法」：除了下面这些，其他请求都要经过。
 *
 * 【一条踩了四次才总结出来的规律】
 * 「默认所有请求都要登录」本身是安全的，但它会静默拦掉那些
 * **给机器（而不是给人）用的入口**。已经踩过四次：
 *   1. /api/cron/study-reminder      定时任务 → 跳登录页，永不执行
 *   2. /manifest.webmanifest         浏览器判断可安装性 → 拿不到 JSON
 *   3. /.well-known/assetlinks.json  安卓验证 App 归属 → 地址栏去不掉
 *   4. /kaoyan-words.apk             安卓下载安装包 → 下到 HTML，装不上
 * 四次的症状完全一样：**什么都不报错，就是不工作。**
 *
 * 所以这里不再一个个枚举后缀，改成「凡是带扩展名的路径一律放行」——
 * 页面路由不会有扩展名，带扩展名的都是静态文件，
 * 静态文件本来就不需要检查登录状态。
 * ══════════════════════════════════════════════════════════════
 *
 * 顺带：每张图都跑一次会话刷新纯属浪费，会明显拖慢页面。
 */
export const config = {
  matcher: [
    /*
     * 排除以下路径：
     * - _next/static  打包出来的 JS/CSS
     * - _next/image   图片优化服务
     * - favicon.ico   网站图标
     * - 任何带扩展名的路径（图标、manifest、apk、assetlinks.json……）
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
