import type { MetadataRoute } from "next";

/**
 * PWA 清单（manifest）。
 *
 * 【这个文件是干什么的】
 * 它告诉手机浏览器：「这个网站可以当成一个 App 装到主屏幕上」。
 * 有了它，手机浏览器才会提供「安装 / 添加到主屏幕」，装完之后：
 *   - 桌面出现一个图标
 *   - 点开是全屏的，没有地址栏和浏览器工具栏
 *   - 有自己的启动画面和主题色
 *
 * 【为什么不用做安装包】
 * 这是网页，不是原生 App。原生 App 要下 .apk / .ipa、要签名、
 * 上架还要审核和年费。而 PWA 直接从浏览器装，不需要商店、不需要签名、
 * 不需要任何费用 —— 对个人长期使用来说这才是对的路子。
 *
 * 【关于 Service Worker】
 * 早年的 Chrome 要求必须注册 Service Worker 才允许安装，
 * 2024 年已经取消了这个要求。这里**刻意不加** Service Worker：
 * 本站的数据全在云端，离线本来就没法用，而缓存一旦写歪，
 * 会让整个网站一直显示旧内容 —— 风险远大于收益。
 *
 * 图标由 scripts/make-icons.py 生成。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "考研词记",
    short_name: "考研词记",
    description: "2028 考研英语词汇",
    start_url: "/",
    // standalone = 去掉浏览器的地址栏和工具栏，看起来就是个 App
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    lang: "zh-CN",
    dir: "ltr",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        // maskable 是给 Android 用的：系统会把图标裁成圆形/水滴形，
        // 所以这张图里的字缩得更小，保证裁切不会切到笔画
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
