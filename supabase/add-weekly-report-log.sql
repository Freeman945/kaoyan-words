-- ============================================================
--  周报发送记录表
-- ============================================================
--  用途：保证「一周只发一封周报」，并记录每次发送的时间。
--
--  执行方式：
--    Supabase 控制台 → 左侧 SQL Editor → 新建查询 → 粘贴本文件 → Run
--
--  只会新增一张表，不会动到已有的 words / user_word_progress / review_logs。
--  重复执行也不会出错（用了 if not exists）。
-- ============================================================

create table if not exists public.weekly_report_log (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id) on delete cascade,

  -- 这一封周报覆盖的那一周的周一（YYYY-MM-DD）
  week_start date not null,

  sent_at timestamptz not null default now(),

  -- ★ 关键：同一个用户、同一周只能有一条记录。
  --   这就是「一周只发一封」的保证 —— 而且它是数据库层面的保证，
  --   所以哪怕你同时打开好几个标签页，也不会收到好几封。
  unique (user_id, week_start)
);

-- ============================================================
--  安全策略（RLS）
-- ============================================================
--  和另外几张表一样：每个人只能读写自己的记录。
--  auth.uid() 是数据库从你的登录凭证里读出来的，客户端伪造不了。
-- ============================================================

alter table public.weekly_report_log enable row level security;

drop policy if exists "本人可查看自己的周报记录" on public.weekly_report_log;
create policy "本人可查看自己的周报记录"
  on public.weekly_report_log for select
  using (auth.uid() = user_id);

drop policy if exists "本人可插入自己的周报记录" on public.weekly_report_log;
create policy "本人可插入自己的周报记录"
  on public.weekly_report_log for insert
  with check (auth.uid() = user_id);

-- 发送失败时要能撤销「占位」，否则这一周就再也补发不了了
drop policy if exists "本人可删除自己的周报记录" on public.weekly_report_log;
create policy "本人可删除自己的周报记录"
  on public.weekly_report_log for delete
  using (auth.uid() = user_id);

-- 刻意不开放 update：发送记录一旦写下就不该被改。

-- 收回 TRUNCATE 等权限：TRUNCATE 会绕过 RLS，等于能清空所有人的记录
revoke truncate, references, trigger on public.weekly_report_log
  from authenticated, anon;

-- ============================================================
--  执行完之后
-- ============================================================
--  可以跑下面这句确认表建好了（应该返回 0 行，不报错）：
--
--    select * from public.weekly_report_log limit 1;
-- ============================================================
