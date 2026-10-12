import type { Metadata } from "next";
import "./globals.css";

// metadata 里的内容会出现在浏览器标签页标题上
export const metadata: Metadata = {
  title: "考研英语背单词",
  description: "为 2027 考研准备的个性化背单词网站",
};

// RootLayout 是这个网站最外层的“骨架”，每个页面都会被塞进 {children} 的位置
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
