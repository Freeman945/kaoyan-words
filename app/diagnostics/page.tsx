/**
 * 诊断页：用来确认「网站 ⇄ Supabase」这条线是否打通。
 *
 * 为什么需要它？
 * 出问题时，报错信息往往只说"连接失败"，初学者很难判断到底是
 * 环境变量没配、密钥写错、还是表还没建。这个页面把三种情况分开显示。
 *
 * 阶段 4 建好 words 表之后，这里应该显示「连接成功」。
 */
import { createClient } from "@/lib/supabase/server";

// 这个页面每次访问都要实时去问数据库，不能被静态缓存
export const dynamic = "force-dynamic";

type CheckResult = {
  level: "success" | "warning" | "error";
  title: string;
  detail: string;
};

/** 去数据库问一句「words 表里有数据吗」，根据回答判断连通性 */
async function checkDatabase(): Promise<CheckResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (error) {
    // 最常见的情况：.env.local 还没配好
    return {
      level: "error",
      title: "环境变量没配好",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const { data, error, count } = await supabase
    .from("words")
    .select("id", { count: "exact" })
    .limit(1);

  if (error) {
    // PGRST205 / 42P01 = 表不存在。
    // 这说明「网络通了、密钥也对」，只是表还没建 —— 阶段 2 的成功标志。
    const tableMissing =
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message.includes("does not exist") ||
      error.message.includes("Could not find the table");

    if (tableMissing) {
      return {
        level: "warning",
        title: "数据库连接成功（words 表还没建，属于正常）",
        detail:
          `Supabase 已经能正确识别你的身份，只是还没有 words 表。\n` +
          `这是阶段 2 的预期结果 —— 阶段 4 会建这张表。\n\n` +
          `原始返回：code=${error.code} message=${error.message}`,
      };
    }

    // 密钥错误、项目地址写错等
    return {
      level: "error",
      title: "连接失败",
      detail: `code=${error.code ?? "(无)"} message=${error.message}`,
    };
  }

  return {
    level: "success",
    title: "数据库连接成功，words 表可读",
    detail: `words 表当前有 ${count ?? data?.length ?? 0} 条记录。`,
  };
}

const LEVEL_STYLE: Record<CheckResult["level"], string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-rose-300 bg-rose-50 text-rose-900",
};

const LEVEL_ICON: Record<CheckResult["level"], string> = {
  success: "✅",
  warning: "🟡",
  error: "❌",
};

export default async function DiagnosticsPage() {
  const result = await checkDatabase();

  // 只显示域名部分，避免把完整密钥之类的信息贴到屏幕上
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(未配置)";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">连接诊断</h1>
        <p className="mt-1 text-sm text-slate-600">
          用来确认网站能不能正常访问 Supabase 数据库。
        </p>
      </div>

      <div className={`rounded-lg border p-4 ${LEVEL_STYLE[result.level]}`}>
        <p className="font-semibold">
          {LEVEL_ICON[result.level]} {result.title}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
          {result.detail}
        </pre>
      </div>

      <dl className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Supabase 项目地址</dt>
          <dd className="break-all text-right font-mono">{supabaseUrl}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">可公开密钥</dt>
          <dd className="text-right font-mono">
            {process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
              ? "已配置"
              : "未配置"}
          </dd>
        </div>
      </dl>
    </main>
  );
}
