"use client";

/**
 * 登录 / 注册表单（客户端组件）。
 *
 * 为什么需要 "use client"：用了 useActionState 这个 Hook 来显示
 * 「提交中」和错误提示，而 Hook 只能在客户端组件里用。
 *
 * 真正的登录逻辑在 app/auth/actions.ts，这里只负责「长什么样」。
 * 登录和注册两套界面几乎一样，所以共用一个组件。
 */
import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/auth/actions";

/** 表单的初始状态：还没有任何错误和提示 */
const INITIAL_STATE: AuthFormState = { error: null, message: null };

type AuthFormProps = {
  /** login = 登录，register = 注册 */
  mode: "login" | "register";
  /** 登录成功后跳到哪。由登录页从 ?next= 传进来 */
  next?: string;
};

export function AuthForm({ mode, next = "/" }: AuthFormProps) {
  const isLogin = mode === "login";

  // useActionState 返回三样东西：
  //   state      —— 上一次提交的结果（错误信息或成功提示）
  //   formAction —— 直接塞给 <form action={...}>
  //   isPending  —— 正在提交中吗？用来禁用按钮防连点
  const [state, formAction, isPending] = useActionState(
    isLogin ? signIn : signUp,
    INITIAL_STATE,
  );

  // focus 只用边框变色，不加光圈/发光
  const inputClass =
    "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm " +
    "outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-500";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          考研词记
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isLogin ? "登录" : "注册"}
        </p>

        <form action={formAction} className="mt-8 space-y-4">
          {/* 隐藏字段：把「登录后去哪」一起提交给服务器 */}
          <input type="hidden" name="next" value={next} />

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-zinc-700"
            >
              邮箱
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700"
            >
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete={isLogin ? "current-password" : "new-password"}
              className={inputClass}
            />
            {!isLogin && (
              // 这条留着：不写的话用户不知道 6 位这个要求，
              // 提交后才报错会白填一次
              <p className="mt-1 text-xs text-zinc-400">至少 6 位</p>
            )}
          </div>

          {/* 出错时 role="alert" 让读屏软件也能念出来 */}
          {state.error !== null && (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {state.error}
            </p>
          )}

          {state.message !== null && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className={
              "h-10 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white " +
              "transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            }
          >
            {isPending ? "处理中" : isLogin ? "登录" : "注册"}
          </button>
        </form>

        <p className="mt-6 text-sm text-zinc-500">
          {isLogin ? (
            <>
              没有账号？{" "}
              <Link
                href="/register"
                className="text-zinc-900 transition-colors hover:underline"
              >
                注册
              </Link>
            </>
          ) : (
            <>
              已有账号？{" "}
              <Link
                href="/login"
                className="text-zinc-900 transition-colors hover:underline"
              >
                登录
              </Link>
            </>
          )}
        </p>

        {/* 连不上时的逃生通道。放得很小，不占视线 */}
        <p className="mt-8 text-xs text-zinc-300">
          <Link href="/diagnostics" className="hover:text-zinc-500">
            连接诊断
          </Link>
        </p>
      </div>
    </main>
  );
}
