# 考研英语背单词

一个为自己长期使用的个性化考研英语背单词网站。目标：每天能真正用起来，学习进度永久保存在云端，换电脑、换手机、退出登录都不会丢。

> 面向 2027 年 12 月考研。英语是薄弱科目，所以这个项目的重点是**长期坚持**和**复习安排**，不是花哨的界面。

## 技术栈

| 用途 | 技术 | 说明 |
| --- | --- | --- |
| 前端框架 | Next.js 16 (App Router) | 一个框架同时管页面和服务器接口 |
| 语言 | TypeScript | 给 JavaScript 加类型，写错立刻报错 |
| UI 库 | React 19 | 负责页面渲染和交互 |
| 样式 | Tailwind CSS 4 | 用 class 名直接写样式，不用单独写 CSS 文件 |
| 数据库 | Supabase (PostgreSQL) | 云端数据库，存单词和学习进度 |
| 登录认证 | Supabase Auth | 邮箱注册 / 登录，不用自己写密码逻辑 |
| 测试 | Node.js 内置测试运行器 + tsx | 给复习算法等纯逻辑写自动化测试 |
| 部署 | Vercel | 免费托管，推送代码自动上线 |
| 版本管理 | Git / GitHub | 记录每次改动，改坏了可以回退 |

刻意**没有**使用 Redis、Docker、微服务等复杂技术 —— 对这个项目没有必要。

## 本地运行

```bash
npm install            # 安装依赖（第一次需要，装完就不用再装）
npm run dev            # 启动开发服务器 → http://localhost:3000
```

其他命令：

```bash
npm test               # 跑自动化测试（复习算法 + 登录提示）
npm run build          # 生产构建（上线前跑一遍，会检查类型错误）
npm run lint           # 代码规范检查
npm run import:words   # 把 data/words-seed.csv 转成 supabase/seed.sql
```

导入自己的词库（几千个词也可以）：

```bash
npm run import:words -- data/kaoyan-5000.csv
```

## 目录结构

```
app/                     页面目录。每个文件夹 = 一个网址
  layout.tsx             全站最外层骨架
  page.tsx               首页 = 网址 /（学习 Dashboard）
  login/page.tsx         登录页
  register/page.tsx      注册页
  diagnostics/page.tsx   连接诊断页（出问题时先看这里）
  auth/actions.ts        登录 / 注册 / 退出的服务端逻辑
components/              可复用的 UI 组件
  AuthForm.tsx           登录与注册共用的表单
  SignOutButton.tsx      退出登录按钮
lib/                     业务逻辑
  env.ts                 读取环境变量，缺配置时给中文提示
  auth.ts                查询当前登录用户 / 强制要求登录
  auth-messages.ts       把 Supabase 英文报错翻译成中文
  spaced-repetition.ts   间隔复习算法（本项目的大脑）
  spaced-repetition.test.ts  算法的自动化测试
  supabase/client.ts     浏览器端数据库客户端
  supabase/server.ts     服务端数据库客户端
  supabase/proxy.ts      会话刷新 + 访问控制
proxy.ts                 每个请求最先经过这里（Next 16 的 middleware）
types/index.ts           数据类型定义（Word / 进度记录 / 掌握程度）
data/words-seed.csv      测试词库（40 个考研核心词汇）
scripts/csv-to-sql.ts    CSV 词库 → SQL 导入脚本
supabase/schema.sql      建表 + 行级安全策略（RLS）
supabase/seed.sql        由脚本生成的单词导入 SQL
.env.local               私密配置（数据库地址、密钥），不进 Git
```

**分工原则**：`app/` 只管「页面长什么样」，`lib/` 只管「数据和规则怎么处理」。这样以后改复习算法只需要动 `lib/spaced-repetition.ts`，不用碰页面代码。

## 数据库配置（一次性）

1. 在 supabase.com 免费创建项目
2. 把 Project URL 和 Publishable key 填进 `.env.local`（参考 `.env.example`）
3. 打开 Supabase 控制台 → SQL Editor，粘贴执行 `supabase/schema.sql`
4. 再粘贴执行 `supabase/seed.sql`（导入 40 个测试单词）
5. 重启 `npm run dev`，访问 `/diagnostics` 应显示绿色「连接成功」

## 常见问题

**注册后一直收不到验证邮件？**
Supabase 免费版自带的邮件服务每小时只能发几封。个人自用最省事的做法是关掉邮箱验证：
控制台 → Authentication → Sign In / Providers → Email → 关闭 `Confirm email`。
这样注册后直接就是登录状态。

**登录状态会莫名其妙丢失？**
先确认你的会话刷新文件叫 `proxy.ts` 而不是 `middleware.ts`。Next.js 16 把
middleware 改名成了 proxy，网上大部分 Supabase 教程还是旧写法，照抄会导致
这段代码根本不执行。

## 间隔复习规则

| 你的选择 | 下次出现 | 掌握程度变化 |
| --- | --- | --- |
| 不认识 | 10 分钟后 | → 0 不认识，连击清零 |
| 模糊 | 1 天后 | → 1 模糊，连击清零 |
| 认识 | 3 → 7 → 14 → 30 → 60 天 | 连击满 4 次 → 3 已掌握 |

规则全部写在 `lib/spaced-repetition.ts` 里，改完跑 `npm test` 即可确认没改坏。

## 开发阶段

- [x] **阶段 1** Next.js + TypeScript + Tailwind 骨架，能正常启动
- [x] **阶段 2** 接入 Supabase 客户端与环境变量校验（待填密钥实测）
- [x] **阶段 3** 注册、登录、退出 + 会话保持（待填密钥实测）
- [x] **阶段 4** 建表 SQL 与词库数据、CSV 导入工具（待执行到 Supabase）
- [x] **阶段 5** 进度表结构与 RLS 安全策略（待执行到 Supabase）
- [x] **阶段 7（核心）** 间隔复习算法 + 31 个自动化测试
- [ ] **阶段 4/5（接入页面）** 背单词页面、保存学习记录
- [ ] **阶段 6** 验证持久化：两个账号实测数据隔离
- [ ] **阶段 7（接入）** 按 `next_review_time` 生成今日复习队列
- [ ] **阶段 8** 学习统计 Dashboard
- [ ] **阶段 9** 优化 UI
- [ ] **阶段 10** 部署到 Vercel
- [ ] **后续** 接入 AI：生成例句、近义词辨析、错词测试、薄弱词总结

## 数据安全原则

1. 核心学习进度**存在 Supabase 数据库**，不只放在浏览器 localStorage 里。
2. 每个用户只能读写自己的学习记录 —— 靠 Supabase 的行级安全策略（RLS）在**数据库层**强制保证，而不是靠前端代码自觉。就算有人改了浏览器里的代码，数据库依然会拒绝。
3. API Key、数据库密钥写在 `.env.local`，这个文件不会提交到 Git。AI 接口一律在服务器端调用，密钥不进浏览器。
