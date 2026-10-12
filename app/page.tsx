// 这是首页。阶段 1 只用来确认：Next.js 能跑 + Tailwind 样式能生效。
// 阶段 8 会把它改造成真正的学习 Dashboard。
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">考研英语背单词</h1>
      <p className="text-slate-600">
        阶段 1 完成：Next.js + TypeScript + Tailwind 骨架已启动成功。
      </p>
      <span className="rounded-full bg-emerald-100 px-4 py-1 text-sm font-medium text-emerald-800">
        Tailwind 样式正常
      </span>
    </main>
  );
}
