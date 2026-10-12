/**
 * 集中读取环境变量。
 *
 * 为什么要单独写一个文件？
 * 1. 如果变量没配好，这里会给出中文提示，而不是让程序在别处莫名其妙地崩掉。
 * 2. 以后要改变量名，只需要改这一个文件，不用全项目搜索替换。
 *
 * 重要概念：只有以 NEXT_PUBLIC_ 开头的变量才会被送到浏览器。
 * 所以下面每个变量名都必须是“写死的字符串”（不能拼出来），
 * 否则 Next.js 在打包时无法识别，浏览器里就会拿到 undefined。
 */

/**
 * 检查一个必需的环境变量是否存在，缺失时抛出中文错误。
 * @param name 变量名，用于错误提示
 * @param value 变量的实际值
 */
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `缺少环境变量 ${name}。\n` +
        `请确认项目根目录下存在 .env.local 文件，并参考 .env.example 填好它。\n` +
        `注意：改完 .env.local 后必须重启 npm run dev 才会生效。`,
    );
  }
  return value;
}

/** Supabase 项目地址，形如 https://abcdefgh.supabase.co */
export function getSupabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/**
 * Supabase 可公开密钥。
 * 新版项目叫 Publishable key（sb_publishable_...），老项目叫 anon key。
 * 两种都支持，优先读新名字。
 */
export function getSupabaseKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
}
