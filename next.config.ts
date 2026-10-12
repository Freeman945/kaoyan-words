import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * 打包时把 data/words-seed.csv 一起带上。
   *
   * 【为什么需要这一行】
   * app/preview/study 这个页面会在运行时用 fs 读本地文件 data/words-seed.csv。
   * 但 Vercel 会把部署的代码拆成一个个"函数包"，只把真正用到的文件塞进去。
   * 它主要靠"分析代码里 import 了什么"来判断 —— 而用 fs.readFile 读的文件
   * 不属于 import，所以理论上可能被漏掉。一旦漏掉，线上打开预览页就会报
   * "读不到文件"。
   *
   * 我实测过：Next.js 的追踪器确实"猜"到了这个文件（它有针对
   * path.resolve(process.cwd(), ...) 这类写法的启发式规则），当前构建产物
   * 里是包含它的。
   *
   * 但"靠它猜对"和"明确告诉它"是两回事：哪天有人把路径拼法改成别的形式，
   * 启发式规则可能就不再命中，预览页会静默失效 —— 而且本地开发完全看不出来
   * （本地那个文件一直在那儿）。所以这里把依赖关系写成明文契约，而不是靠猜。
   */
  outputFileTracingIncludes: {
    "/preview/study": ["./data/words-seed.csv"],
  },

  /*
   * 不在响应头里暴露 "X-Powered-By: Next.js"。
   *
   * 默认情况下 Next.js 会告诉每一个访客"我用的是 Next.js"。这本身不是漏洞，
   * 但等于免费给攻击者提供了一条线索：知道框架和大致版本，就能去查对应的
   * 已知问题。关掉它成本为零，属于顺手做的事。
   *
   * 我在生产模式实测过：加上这行之前，响应头里确实有 X-Powered-By。
   */
  poweredByHeader: false,

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
