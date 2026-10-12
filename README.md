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
| 测试 | Node 内置测试运行器 + tsx + PGlite | 连数据库安全策略都能在本地验证 |
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
npm test               # 跑全部自动化测试（118 个用例）
                       #   算法 46 · 统计 26 · 界面渲染 13 · 数据库安全 33
npm run build          # 生产构建（上线前跑一遍，会检查类型错误）
npm run lint           # 代码规范检查
npm run import:words   # 把 data/words-seed.csv 转成 supabase/seed.sql
```

导入自己的词库（几千个词也可以）：

```bash
npm run import:words -- data/kaoyan-5000.csv
```

## 现在就能看的东西

不用等数据库，打开 **http://localhost:3000/preview/study** 就能试背单词：
显示释义 → 不认识 / 模糊 / 认识 → 自动下一个。按钮下方的「10 分钟后 /
1 天后 / 3 天后」是真实复习算法算出来的。

连续对同一个词点「认识」，再点「再来一轮」，你会看到间隔从 3 天变成 7 天、
14 天、30 天 —— 这就是间隔复习在起作用。

## 想搞懂它是怎么运作的？读 `docs/`

代码能跑不等于你懂了。`docs/` 里有三篇专门写给 Web 初学者的讲解文档：

| 文档 | 内容 |
| --- | --- |
| [01-点击不认识的完整旅程](docs/01-点击不认识的完整旅程.md) | **建议先看这篇**。把「你点一下『不认识』之后，数据从浏览器 → 服务器 → 数据库 → 再回到页面」的完整链路拆成 10 步讲清楚，带真实文件行号。 |
| [02-页面是怎么显示出来的](docs/02-页面是怎么显示出来的.md) | 服务端组件和客户端组件为什么分开、hydration 是什么、为什么释义在源码里却看不见。 |
| [03-出问题时怎么排查](docs/03-出问题时怎么排查.md) | 白屏、报错、数字不对时从哪查起；常见症状对照表。 |
| [04-部署上线](docs/04-部署上线.md) | 发布到 Vercel 的完整步骤、花费说明、以及最容易踩的那个坑（`NEXT_PUBLIC_` 变量是构建时写死的）。 |

## 目录结构

```
app/                     页面目录。每个文件夹 = 一个网址
  layout.tsx             全站最外层骨架
  page.tsx               首页 = 学习 Dashboard（统计 + 开始学习）
  study/page.tsx         背单词页（正式版，会保存进度）
  study/actions.ts       保存作答的 Server Action
  login/page.tsx         登录页
  register/page.tsx      注册页
  diagnostics/page.tsx   连接诊断页（出问题时先看这里）
  preview/study/page.tsx 背单词界面预览（不需要数据库）
  auth/actions.ts        登录 / 注册 / 退出的服务端逻辑
components/              可复用的 UI 组件
  AuthForm.tsx           登录与注册共用的表单
  SignOutButton.tsx      退出登录按钮
  SetupNotice.tsx        「数据库还没配置」的引导页
  WordCard.tsx           单词卡（释义默认隐藏）
  RatingButtons.tsx      三个作答按钮
  StudySession.tsx       背单词核心交互
  PreviewStudySession.tsx 预览外壳
lib/                     业务逻辑
  env.ts                 读取环境变量，缺配置时给中文提示
  auth.ts                查询当前登录用户 / 强制要求登录
  auth-messages.ts       把 Supabase 英文报错翻译成中文
  csv.ts                 CSV 解析器
  words.ts               词库读取与列定义
  spaced-repetition.ts   间隔复习算法（本项目的大脑）
  stats.ts               学习统计（时区处理、连续天数、7 天图表）
  progress.ts            学习进度的数据库读写
  supabase/client.ts     浏览器端数据库客户端
  supabase/server.ts     服务端数据库客户端
  supabase/proxy.ts      会话刷新 + 访问控制
proxy.ts                 每个请求最先经过这里（Next 16 的 middleware）
types/index.ts           数据类型定义
types/database.ts        数据库表结构类型：让 TypeScript 校验每条查询
data/words-seed.csv      测试词库（40 个考研核心词汇）
scripts/csv-to-sql.ts    CSV 词库 → SQL 导入脚本
supabase/schema.sql      建表 + 行级安全策略（RLS）+ 取新词的函数
supabase/seed.sql        由脚本生成的单词导入 SQL
supabase/schema.test.ts  用本地 Postgres 验证 RLS 真的能隔离用户数据
supabase/supabase-shim.sql  测试用的 Supabase 环境替身
docs/                    写给初学者的讲解文档（见上面一节）
.env.local               私密配置（数据库地址、密钥），不进 Git
```

**分工原则**：`app/` 只管「页面长什么样」，`lib/` 只管「数据和规则怎么处理」。这样以后改复习算法只需要动 `lib/spaced-repetition.ts`，不用碰页面代码。

`types/database.ts` 值得单独说一句：它把三张表的字段告诉了 TypeScript，
于是**列名写错、表名写错、关联查询名写错、参数名写错都会在编译时报错**，
而不是等到运行时页面崩掉。改完代码跑一次 `npx tsc --noEmit` 就能发现。
（正式项目里这个文件可以用 `npx supabase gen types typescript` 自动生成。）

## 数据库配置（一次性）

1. 在 supabase.com 免费创建项目
2. 把 Project URL 和 Publishable key 填进 `.env.local`（参考 `.env.example`）
3. 打开 Supabase 控制台 → SQL Editor，粘贴执行 `supabase/schema.sql`
4. 再粘贴执行 `supabase/seed.sql`（导入 40 个测试单词）
5. 重启 `npm run dev`，访问 `/diagnostics` 应显示绿色「连接成功」

## 三张表

| 表 | 存什么 | 谁能读 | 谁能写 |
| --- | --- | --- | --- |
| `words` | 单词库（公共数据） | 所有人（含未登录） | 谁都不能，只能在控制台改 |
| `user_word_progress` | 你对每个词的当前进度 | 只有你自己 | 只有你自己 |
| `review_logs` | 每一次作答的流水 | 只有你自己 | 只能追加，不能改也不能删 |

`review_logs` 存在的理由：`user_word_progress` 里只有 `last_review_time`，
它记录的是**最近一次**复习时间。如果你周一背了一次、周三又背一次，周一那次
就被覆盖了，Dashboard 上「最近 7 天每天学了多少」就算不准。流水表则一笔一笔记下来，
同时也为将来的 AI 功能（错词测试、薄弱词总结）准备了历史数据。

## 安全策略已经过实测验证

「用户 A 绝对看不到用户 B 的数据」这条规则，**不是靠前端代码自觉，而是在数据库层强制的**。
而且它已经被真跑过一遍：`supabase/schema.test.ts` 会在本地用 PGlite
（编译成 WebAssembly 的真实 PostgreSQL）起一个临时数据库，先跑
`supabase-shim.sql`（Supabase 环境替身），再把真正的 `supabase/schema.sql`
原封不动执行，然后扮演 A、B、未登录访客三种身份反复试探。

```bash
npm test
```

覆盖的关键场景：

- A 查自己的进度只有 1 条；B 也是 1 条，互相看不到
- A 就算显式写 `where user_id = B的ID`，也只会拿到 0 行
- A 不能把进度写到 B 名下（`with check` 拦截）
- A 改不动、删不掉 B 的记录（受影响行数为 0）
- 未登录访客连进度表都没有访问权限
- 谁都不能往单词库插数据，也不能 `truncate` 清空它（TRUNCATE 不看 RLS，权限单独收回了）
- 流水记录只能追加，改不了也删不掉

## 常见问题

**注册后一直收不到验证邮件？**
Supabase 免费版自带的邮件服务每小时只能发几封。个人自用最省事的做法是关掉邮箱验证：
控制台 → Authentication → Sign In / Providers → Email → 关闭 `Confirm email`。
这样注册后直接就是登录状态。

**登录状态会莫名其妙丢失？**
先确认你的会话刷新文件叫 `proxy.ts` 而不是 `middleware.ts`。Next.js 16 把
middleware 改名成了 proxy，网上大部分 Supabase 教程还是旧写法，照抄会导致
这段代码根本不执行。

**背单词时释义能不能真的藏住？**
视觉上可以，但数据本身会随页面一起发给浏览器（所有客户端渲染的应用都这样，
Anki、欧路词典也一样）。想彻底藏住，得改成「点显示释义时才向服务器要答案」，
那要多一次网络往返，对自用没有必要。

## 间隔复习规则

| 你的选择 | 下次出现 | 掌握程度变化 |
| --- | --- | --- |
| 不认识 | 10 分钟后 | → 0 不认识，连击清零 |
| 模糊 | 1 天后 | → 1 模糊，连击清零 |
| 认识 | 3 → 7 → 14 → 30 → 60 天 | 连击满 4 次 → 3 已掌握 |

规则全部写在 `lib/spaced-repetition.ts` 里，改完跑 `npm test` 即可确认没改坏。

## 开发阶段

- [x] **阶段 1** Next.js + TypeScript + Tailwind 骨架
- [x] **阶段 2** Supabase 客户端与环境变量校验（待填密钥实测）
- [x] **阶段 3** 注册、登录、退出 + 会话保持
- [x] **阶段 4** 建表 SQL、词库数据、CSV 导入工具
- [x] **阶段 5** 进度表结构 + RLS 安全策略 + 流水表
- [x] **阶段 7（核心）** 间隔复习算法 + 46 个测试
- [x] **背单词界面** 单词卡 / 三按钮 / 交互会话 + 免数据库预览页
- [x] **阶段 5（代码）** `/study` 页 + Server Action 写入进度与流水
- [x] **阶段 8（代码）** Dashboard 统计 + 最近 7 天柱状图 + 连续学习天数
- [x] **阶段 6（准备）** 用 PGlite 实测 RLS 用户数据隔离（33 个数据库测试）
- [ ] **阶段 2/4 实测** 填入密钥，把 SQL 执行到真实 Supabase
- [ ] **阶段 6（实测）** 两个真实账号验证隔离与跨设备持久化
- [ ] **阶段 7（接入）** 复习队列已接通，待实测
- [ ] **阶段 9** 优化 UI
- [ ] **阶段 10** 部署到 Vercel
- [ ] **后续** 接入 AI：生成例句、近义词辨析、错词测试、薄弱词总结

## 数据安全原则

1. 核心学习进度**存在 Supabase 数据库**，不只放在浏览器 localStorage 里。
2. 每个用户只能读写自己的学习记录 —— 靠 RLS 在**数据库层**强制保证，而不是靠前端代码自觉。就算有人改了浏览器里的代码，数据库依然会拒绝。
3. 登录凭证存在 HttpOnly cookie 里，浏览器上的 JavaScript 读不到，防 XSS 窃取。
4. API Key、数据库密钥写在 `.env.local`，这个文件不会提交到 Git。AI 接口一律在服务器端调用，密钥不进浏览器。
