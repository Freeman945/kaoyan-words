import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * 这个页面必须「每次请求都重新渲染」，不能被提前生成成静态页面。
 *
 * 【为什么必须显式写这一行】
 * Next.js 会偷懒：如果一个页面在构建时不需要读 cookie，它就会把页面
 * 提前生成成一份静态 HTML 重复使用（这样更快）。
 *
 * 正常情况下，首页调用了 cookies()（通过 requireUser），Next.js 就知道
 * 「这页跟具体用户有关」，自动改成动态渲染。
 * 但有个坑：构建时如果还没配 .env.local，上面的 isSupabaseConfigured()
 * 会提前 return，于是 cookies() 从没被调用过 —— Next.js 就会把首页
 * 错误地预生成成静态页，之后即使配好了密钥，也一直显示「数据库还没配置」。
 *
 * 所以这里明确告诉 Next.js：别预生成，每次都实打实地渲染一遍。
 * 涉及登录状态的页面都应该这样写。
 */
export const dynamic = "force-dynamic";

/**
 * 还没配置数据库时显示的引导页。
 *
 * 为什么要单独做这个？
 * 新手最常见的状态是「代码跑起来了，但还没注册 Supabase」。
 * 如果这时直接抛一堆英文报错，人会懵。所以给一条明确的三步指引。
 */
function SetupNotice() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">考研英语背单词</h1>

      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
        <p className="font-semibold">🟡 数据库还没配置</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>去 supabase.com 免费创建一个项目</li>
          <li>
            把 <strong>Project URL</strong> 和 <strong>Publishable key</strong>{" "}
            填进项目根目录的 <code className="rounded bg-white/70 px-1">.env.local</code>
          </li>
          <li>重启开发服务器（Ctrl+C 后重新 npm run dev）</li>
        </ol>
        <p className="mt-4 text-sm">
          需要哪些变量，参考项目根目录的{" "}
          <code className="rounded bg-white/70 px-1">.env.example</code>。
        </p>
        <p className="mt-2 text-sm">
          填好后打开{" "}
          <Link href="/diagnostics" className="font-medium underline">
            连接诊断
          </Link>{" "}
          确认是否打通。
        </p>
      </div>
    </main>
  );
}

/**
 * 首页。
 *
 * 阶段 3 暂时用来看「登录有没有成功」。阶段 8 会把它换成真正的
 * 学习 Dashboard（今日新词数、待复习数、已掌握数……）。
 */
export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  // 没登录的话，requireUser() 内部会直接跳转到 /login
  const user = await requireUser();

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">考研英语背单词</h1>
        <SignOutButton />
      </div>

      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5">
        <p className="font-semibold text-emerald-900">✅ 登录成功</p>
        <p className="mt-1 break-all text-sm text-emerald-800">
          当前账号：{user.email ?? "（未提供邮箱）"}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-emerald-700">
          用户 ID：{user.id}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600">
        <p className="font-medium text-slate-900">阶段 3：请做这个验证</p>
        <p className="mt-2">
          <strong>按 F5 刷新页面，或者关掉标签页重新打开</strong>
          —— 你应该仍然是登录状态，直接回到这一页。
        </p>
        <p className="mt-2">
          原因是：登录凭证没有存在 JavaScript 能读到的地方，而是存在一个
          HttpOnly cookie 里，由服务器读取。这既保证了刷新不丢登录，
          也防止了网页上的恶意脚本偷走你的登录状态。
        </p>
        <p className="mt-3">
          <Link href="/diagnostics" className="underline underline-offset-2">
            连接诊断
          </Link>
        </p>
      </div>
    </main>
  );
}
