import type { Metadata } from "next";
import "./globals.css";

// metadata 里的内容会出现在浏览器标签页标题上
export const metadata: Metadata = {
  title: {
    default: "考研词记",
    template: "%s · 考研词记",
  },
  description: "2028 考研英语词汇",
};

/**
 * RootLayout 是这个网站最外层的骨架，每个页面都会被塞进 {children} 的位置。
 *
 * 背景用 zinc-50（#fafafa）、正文用 zinc-900（#18181b），
 * 是一套中性灰；整站只有一个强调色（zinc-900 的深灰本身），
 * 状态色只在必要时出现（绿=掌握、橙=模糊、红=不认识）。
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-zinc-50 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
