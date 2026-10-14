/**
 * 退出登录按钮。
 *
 * 【一个值得注意的细节】
 * 这个文件没有 "use client"。为什么可以？
 * 因为「表单 + Server Action」是最基础的 HTML 能力：
 * <form action={signOut}> 提交时会由 Next.js 把请求交给服务器上的 signOut 函数，
 * 不需要任何浏览器端 JavaScript 参与。所以它可以直接是服务端组件，更省流量。
 *
 * 这也是为什么「能用表单就用表单」是个好习惯 —— 页面还没加载完 JS，
 * 按钮就已经能用了。
 */
import { signOut } from "@/app/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
      >
        退出
      </button>
    </form>
  );
}
