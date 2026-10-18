/**
 * 导出「需要重点关注的单词」为 CSV 文件。
 *
 * 用法：`/api/export/attention?days=7`
 *
 * 【为什么做成 GET 接口，而不是 Server Action】
 * 浏览器点一个链接就能直接下载文件，手机上也能用（会弹「下载」）。
 * 如果用 Server Action，就得把整份 CSV 塞进页面再用 JS 造一个 blob ——
 * 多绕一圈，而且手机浏览器对 blob 下载的支持参差不齐。
 *
 * 【安全】
 * 这个路径没有扩展名，所以它**在中间件的保护范围内**（不在放行名单里），
 * 未登录会被重定向到登录页。这里还会再确认一次身份，双保险。
 * 另外 `days` 参数会被夹到 1~30，防止 `?days=999999` 把数据库拖垮。
 */
import { getCurrentUser } from "@/lib/auth";
import { buildAttentionCsv, clampExportDays } from "@/lib/attention-export";
import { getAttentionWords } from "@/lib/progress";

// 每次都要现算，不能被缓存
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user === null) {
    return new Response("请先登录再导出。", { status: 401 });
  }

  const url = new URL(request.url);
  const days = clampExportDays(Number(url.searchParams.get("days") ?? "7"));

  try {
    const rows = await getAttentionWords(user.id, days);
    const csv = buildAttentionCsv(rows);
    const chineseName = `需重点关注的单词-最近${days}天.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        /*
         * 中文文件名要按 RFC 5987 用 filename* 报给浏览器，
         * 同时给一个纯英文的 filename 兜底（老浏览器只认它）。
         */
        "Content-Disposition":
          `attachment; filename="attention-${days}d.csv"; ` +
          `filename*=UTF-8''${encodeURIComponent(chineseName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "导出失败。";
    return new Response(`导出失败：${message}`, { status: 500 });
  }
}
