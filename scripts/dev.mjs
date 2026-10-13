/**
 * 开发服务器启动器。
 *
 * 【为什么需要多这一层】
 * 这台电脑通过 127.0.0.1:7897 上的代理上网。但 **Node.js 默认不读 Windows
 * 的系统代理设置**，它会直接连出去 —— 而直连 Supabase 会被重置，
 * 页面报 "fetch failed"。（PowerShell 能连上，是因为 .NET 会读系统代理。）
 *
 * Node 提供了一个开关 `NODE_USE_ENV_PROXY=1`，作用是"请读取 HTTPS_PROXY
 * 这个环境变量"。
 *
 * 【关键：为什么不能直接写在 .env.local 里】
 * 那个开关只在 **Node 进程启动的那一瞬间** 被读取。
 * 而 `.env.local` 是 Next.js 启动**之后**才加载进内存的 —— 已经太晚了，
 * 实测无效。
 *
 * 所以这个脚本在启动 Next.js **之前**先读一次 `.env.local`，
 * 把代理设置放进真正的进程环境变量里，再拉起 Next.js。
 * 这样子进程（Next）在启动时就能看到这个开关。
 *
 * 部署到 Vercel 之后完全用不到这段逻辑（那边没有代理，直接连）。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(projectRoot, ".env.local");

/**
 * 从 .env.local 里读一个变量。
 * 只处理 `KEY=VALUE` 这种简单格式（够用了，我们不去实现完整的 dotenv）。
 */
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

const env = { ...process.env };

// 优先用命令行里已经设好的，其次从 .env.local 读
const proxy = env.HTTPS_PROXY ?? readEnvFileValue("HTTPS_PROXY");

if (proxy !== undefined && proxy !== "") {
  env.HTTPS_PROXY = proxy;
  env.HTTP_PROXY = env.HTTP_PROXY ?? proxy;
  env.NODE_USE_ENV_PROXY = "1";
  console.log(`[dev] 已通过代理访问外网：${proxy}`);
} else {
  console.log("[dev] 未检测到代理设置，按直连启动。");
  console.log("      如果页面报 fetch failed，请检查 .env.local 里的 HTTPS_PROXY。");
}

// stdio: "inherit" 让 Next.js 的日志直接显示在当前终端里。
//
// 这里用「用当前的 node 可执行文件去跑 next 的 JS 入口」这种方式，
// 而不是 spawn("next", ..., { shell: true })：
// 后者需要经过一层命令行解释器来解析 next.cmd，Node 会为此发出
// DEP0190 警告（参数没有被正确转义），而且在不同系统上行为不一致。
// 直接指定 JS 文件则不需要 shell，跨平台且没有警告。
const nextCli = resolve(projectRoot, "node_modules/next/dist/bin/next");

const child = spawn(process.execPath, [nextCli, "dev"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
