-- ============================================================
--  晚间学习提醒的发送记录表
-- ============================================================
--  用途：保证「一天只提醒一次」。
--
--  执行方式：
--    Supabase 控制台 → 左侧 SQL Editor → 新建查询 → 粘贴本文件 → Run
--
--  只新增一张表，不动已有的数据。重复执行也不会出错。
-- ============================================================

create table if not exists public.study_reminder_log (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id) on delete cascade,

  -- 这条提醒是哪一天的（按北京时间的日期）
  reminder_date date not null,

  sent_at timestamptz not null default now(),

  -- ★ 关键：同一个用户、同一天只能有一条记录。
  --   定时任务万一重试，也不会给你发第二封。
  unique (user_id, reminder_date)
);

-- ============================================================
--  安全策略（RLS）
-- ============================================================
--  这张表只有定时任务会写，而定时任务用的是 secret key
--  （secret key 会绕过 RLS，它相当于数据库管理员）。
--
--  所以这里只需要一条「本人可以查看自己的提醒记录」的策略，
--  让你以后想查「我收到过哪些提醒」时能查到。
--  不开放 insert / update / delete —— 普通登录态本来也不该改这个。
-- ============================================================

alter table public.study_reminder_log enable row level security;

drop policy if exists "本人可查看自己的提醒记录" on public.study_reminder_log;
create policy "本人可查看自己的提醒记录"
  on public.study_reminder_log for select
  using (auth.uid() = user_id);

-- 收回 TRUNCATE：它会绕过 RLS，等于能清空所有人的记录
revoke truncate, references, trigger on public.study_reminder_log
  from authenticated, anon;

-- ============================================================
--  执行完之后
-- ============================================================
--  可以跑下面这句确认表建好了（应该返回 0 行，不报错）：
--
--    select * from public.study_reminder_log limit 1;
-- ============================================================
