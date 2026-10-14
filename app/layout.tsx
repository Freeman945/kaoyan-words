import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * metadata 里的内容会出现在浏览器标签页标题上。
 *
 * 【和 PWA 有关的三项】
 *   manifest      —— 让手机浏览器知道「这个网站可以装成 App」
 *   icons.apple   —— iOS 主屏图标。iOS 不读 manifest 里的图标，
 *                    它只认 apple-touch-icon，所以这一项不能少
 *   appleWebApp   —— 装到 iOS 主屏后以全屏方式打开
 *
 * manifest 对应的是 app/manifest.ts，Next.js 会自动生成
 * /manifest.webmanifest 并插入 <link rel="manifest">。
 */
export const metadata: Metadata = {
  title: {
    default: "考研词记",
    template: "%s · 考研词记",
  },
  description: "2028 考研英语词汇",
  applicationName: "考研词记",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "考研词记",
    // default = 保留系统状态栏的白底黑字，不强行改成黑色，
    // 和网站本身的浅色背景更协调
    statusBarStyle: "default",
  },
};

/**
 * viewport 控制「手机怎么显示这个页面」。
 *
 * viewportFit: "cover" 是给刘海屏/挖孔屏用的：让页面延伸到整块屏幕，
 * 配合 CSS 里的 env(safe-area-inset-*) 使用，内容才不会被刘海挡住。
 */
export const viewport: Viewport = {
  themeColor: "#fafafa",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * RootLayout 是这个网站最外层的骨架，每个页面都会被塞进 {children} 的位置。
 *
 * 背景用 zinc-50（#fafafa）、正文用 zinc-900（#18181b），
 * 是一套中性灰；整站只有一个强调色，状态色只在必要时出现。
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
