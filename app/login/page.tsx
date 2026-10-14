import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "登录",
};

/**
 * 登录页。
 *
 * 【searchParams 是什么】
 * 网址里 ? 后面的部分。例如 proxy.ts 把你挡到
 *   /login?next=/study
 * 时，这里的 next 就是 "/study"，登录成功后可以直接跳回去。
 *
 * 【Next.js 16 的一个变化】
 * searchParams 现在是 Promise，必须 await 才能拿到值。
 * Next.js 15 之前是直接给对象的，网上老教程会写成同步取值，那样在 16 里会报错。
 */
type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  // 参数可能是数组（?next=a&next=b），所以要先判断类型再用
  const next = typeof params.next === "string" ? params.next : "/";

  return <AuthForm mode="login" next={next} />;
}
