/**
 * 验证一个「已经部署好的」网址是不是真的能用。
 *
 * 用途：部署到 Vercel 之后，用它一次性检查线上环境的各项表现，
 * 而不是靠人肉点来点去。
 *
 * 用法：
 *   npm run verify:deployed -- https://你的网址.vercel.app
 *
 * 它检查的是「只有线上环境才会暴露的问题」：
 *   - 服务能不能正常响应
 *   - 环境变量有没有在构建时正确内联进去（这是最容易踩的坑）
 *   - 未登录访问受保护页面会不会正确跳转
 *   - 有没有把框架信息暴露在响应头里
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(thisFile), "..");
const envFilePath = resolve(projectRoot, ".env.local");

function readEnvFileValue(name) {
  if (!existsSync(envFilePath)) return undefined;
  for (const rawLine of readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).trim() === name) {
      return line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

// 和 verify-supabase.mjs 一样：让 Node 用上代理。但必须把本机地址排除在外，
// 否则测 localhost 时请求也会被扔进代理，直接失败。
if (process.env.NODE_USE_ENV_PROXY !== "1") {
  const proxy = readEnvFileValue("HTTPS_PROXY");
  if (proxy) {
    console.log(`[verify] 检测到代理 ${proxy}，正在以代理模式重启…\n`);
    const exitCode = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [thisFile, ...process.argv.slice(2)], {
        env: {
          ...process.env,
          HTTPS_PROXY: proxy,
          HTTP_PROXY: proxy,
          NO_PROXY: "localhost,127.0.0.1,::1",
          NODE_USE_ENV_PROXY: "1",
        },
        stdio: "inherit",
      });
      child.on("exit", (code) => resolvePromise(code ?? 0));
    });
    process.exit(exitCode);
  }
}

const target = process.argv[2];

if (!target) {
  console.error("用法：npm run verify:deployed -- https://你的网址.vercel.app");
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(target).origin;
} catch {
  console.error(`❌ 网址格式不对：${target}`);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}${detail ? `  →  ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`❌ ${name}${detail ? `  →  ${detail}` : ""}`);
  }
}

/** 发一个请求，不自动跟随跳转，方便观察跳转本身 */
async function request(path, redirect = "manual") {
  const response = await fetch(`${baseUrl}${path}`, { redirect });
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

console.log(`目标网址：${baseUrl}\n`);

// ── 一、基本可用性 ──
console.log("── 一、基本可用性 ──");

let home;
try {
  home = await request("/");
} catch (error) {
  console.error(`\n❌ 根本连不上：${error.cause?.code ?? error.message}`);
  console.error("   网址写错？或者部署还没完成？");
  process.exit(1);
}

check("首页能访问", home.status === 200 || home.status === 307, `HTTP ${home.status}`);

const login = await request("/login");
check("登录页能访问", login.status === 200, `HTTP ${login.status}`);
check(
  "登录页确实是我们的应用",
  login.body.includes("考研英语背单词") || login.body.includes("邮箱"),
);

// ── 二、环境变量是否内联成功（部署最容易出问题的地方）──
console.log("\n── 二、环境变量是否在构建时正确内联 ──");

const diagnostics = await request("/diagnostics");
check("诊断页能访问", diagnostics.status === 200, `HTTP ${diagnostics.status}`);

const notConfigured = diagnostics.body.includes("环境变量没配好");
const connected = diagnostics.body.includes("数据库连接成功");
const tableMissing = diagnostics.body.includes("words 表还没建");
const connectFailed = diagnostics.body.includes("连接失败");

check(
  "环境变量已配置（不是「环境变量没配好」）",
  !notConfigured,
  notConfigured ? "说明 NEXT_PUBLIC_* 没能在构建时拿到 —— 需要补变量后重新部署" : "",
);
check("真的连上了 Supabase", connected && !connectFailed);
check("单词库有数据（words 表存在）", !tableMissing, tableMissing ? "需要执行 seed.sql" : "");

if (connected && !tableMissing) {
  const countMatch = diagnostics.body.match(/words 表当前有 (\d+) 条记录/);
  check(
    "能读出单词数量",
    countMatch !== null,
    countMatch ? `${countMatch[1]} 个单词` : "（没匹配到数量）",
  );
}

// ── 三、访问控制（线上未登录的行为）──
console.log("\n── 三、未登录时的访问控制 ──");

const study = await request("/study");
check(
  "未登录访问 /study 会跳转登录页",
  study.status === 307 || study.status === 302,
  `HTTP ${study.status}`,
);
check(
  "跳转时保留了原始去向（?next=）",
  study.status === 307 || study.status === 302
    ? (study.headers.get("location") ?? "").includes("next")
    : false,
  study.headers.get("location") ?? "",
);

// ── 四、响应头（安全加固是否生效）──
console.log("\n── 四、响应头 ──");

check(
  "没有暴露 X-Powered-By",
  login.headers.get("x-powered-by") === null,
  login.headers.get("x-powered-by") ?? "（已隐藏）",
);

// ── 汇总 ──
console.log("\n" + "═".repeat(52));
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
console.log("═".repeat(52));
process.exit(failed > 0 ? 1 : 0);
