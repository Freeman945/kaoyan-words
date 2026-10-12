import Link from "next/link";

/**
 * 「数据库还没配置」时显示的引导页。
 *
 * 为什么要单独抽出来？
 * 首页和背单词页都需要这段提示。新手最常见的状态就是
 * 「代码跑起来了，但还没注册 Supabase」，如果此时看到一堆英文报错会懵。
 * 两处共用一份，改文案也只用改一个地方。
 */
export function SetupNotice() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">考研英语背单词</h1>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
        <p className="font-semibold">🟡 数据库还没配置</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>去 supabase.com 免费创建一个项目</li>
          <li>
            把 <strong>Project URL</strong> 和 <strong>Publishable key</strong>{" "}
            填进项目根目录的{" "}
            <code className="rounded bg-white/70 px-1">.env.local</code>
          </li>
          <li>重启开发服务器（Ctrl+C 后重新 npm run dev）</li>
        </ol>
        <p className="mt-4 text-sm">
          填好后打开{" "}
          <Link href="/diagnostics" className="font-medium underline">
            连接诊断
          </Link>{" "}
          确认是否打通。
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <p className="font-medium text-slate-900">
          不想等数据库？先看看背单词界面
        </p>
        <p className="mt-2 text-slate-600">
          这是一个不需要数据库的预览：用本地 40 个测试单词，完整演示
          「显示释义 → 三选一 → 自动下一个」的流程。按钮下方的
          「10 分钟后 / 1 天后 / 3 天后」是真实复习算法算出来的结果。
        </p>
        <p className="mt-3">
          <Link
            href="/preview/study"
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            打开背单词预览 →
          </Link>
        </p>
      </div>
    </main>
  );
}
