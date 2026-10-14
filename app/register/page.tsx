import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "注册",
};

/** 注册页。和登录页共用同一个 AuthForm 组件，只是换个模式。 */
export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
