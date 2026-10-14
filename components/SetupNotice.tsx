import Link from "next/link";

/**
 * 「数据库还没配置」时显示的引导页。
 *
 * 首页和背单词页都要用，所以抽出来共用一份 —— 改文案只用改这里。
 * 它只在「代码跑起来了但还没连上 Supabase」这个状态下出现，
 * 所以可以直接写操作步骤，不用客套。
 */
export function SetupNotice() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-14">
      <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
        考研词记
      </h1>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-medium">数据库未配置</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>在 supabase.com 创建一个项目</li>
          <li>
            把 <strong>Project URL</strong> 和 <strong>Publishable key</strong>{" "}
            填进项目根目录的{" "}
            <code className="rounded bg-white/70 px-1 text-xs">.env.local</code>
          </li>
          <li>重启开发服务器</li>
        </ol>
        <p className="mt-3">
          填好后打开{" "}
          <Link href="/diagnostics" className="font-medium underline">
            连接诊断
          </Link>
          。
        </p>
      </div>

      <p className="mt-6 text-sm text-zinc-500">
        不想等数据库，可以先看{" "}
        <Link
          href="/preview/study"
          className="text-zinc-900 transition-colors hover:underline"
        >
          背单词界面预览
        </Link>
        （本地 40 个词，不写数据库）。
      </p>
    </main>
  );
}
