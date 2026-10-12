"use client";

/**
 * 登录 / 注册表单（客户端组件）。
 *
 * 为什么这个文件需要 "use client"？
 * 因为它用了 useActionState 这个 React Hook 来显示「提交中…」和错误提示。
 * Hook 只能在客户端组件里用。文件第一行的 "use client" 声明了「这个文件和
 * 它引用的东西属于浏览器端」。
 *
 * 但注意：真正的登录逻辑不在这里，而在 app/auth/actions.ts 里。
 * 这个文件只负责「长什么样」和「提交时把数据交给谁」。
 */
import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/auth/actions";

/** 表单的初始状态：还没有任何错误和提示 */
const INITIAL_STATE: AuthFormState = { error: null, message: null };

type AuthFormProps = {
  /** login = 登录，register = 注册。两套界面几乎一样，所以共用一个组件。 */
  mode: "login" | "register";
  /** 登录成功后要跳到哪。由登录页从网址参数 ?next= 传进来。 */
  next?: string;
};

export function AuthForm({ mode, next = "/" }: AuthFormProps) {
  const isLogin = mode === "login";

  // useActionState 返回三样东西：
  //   state      —— 上一次提交的结果（这里是错误信息或成功提示）
  //   formAction —— 直接塞给 <form action={...}> 用
  //   isPending  —— 正在提交中吗？用来禁用按钮、防止连点
  const [state, formAction, isPending] = useActionState(
    isLogin ? signIn : signUp,
    INITIAL_STATE,
  );

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm " +
    "outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isLogin ? "登录" : "注册"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {isLogin ? "继续你的背单词进度" : "创建账号，学习进度会保存在云端"}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          {/* 隐藏字段：把「登录后去哪」一起提交给服务器 */}
          <input type="hidden" name="next" value={next} />

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700"
            >
              邮箱
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="至少 6 位"
              // 让浏览器密码管理器知道：这是登录框还是注册框
              autoComplete={isLogin ? "current-password" : "new-password"}
              className={inputClass}
            />
          </div>

          {/* 出错时的红色提示。role="alert" 让读屏软件也能念出来 */}
          {state.error !== null && (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {state.error}
            </p>
          )}

          {/* 成功时的绿色提示，例如「请去邮箱确认」 */}
          {state.message !== null && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "处理中…" : isLogin ? "登录" : "注册"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          {isLogin ? (
            <>
              还没有账号？{" "}
              <Link
                href="/register"
                className="font-medium text-slate-900 underline underline-offset-2"
              >
                去注册
              </Link>
            </>
          ) : (
            <>
              已经有账号了？{" "}
              <Link
                href="/login"
                className="font-medium text-slate-900 underline underline-offset-2"
              >
                去登录
              </Link>
            </>
          )}
        </p>

        {/* 一个给初学者的逃生通道：连不上时先跑诊断 */}
        <p className="mt-2 text-center text-xs text-slate-400">
          连不上数据库？试试{" "}
          <Link href="/diagnostics" className="underline underline-offset-2">
            连接诊断
          </Link>
        </p>
      </div>
    </main>
  );
}
