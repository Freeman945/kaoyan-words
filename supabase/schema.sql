-- ============================================================
-- 考研英语背单词 —— 数据库表结构 + 安全策略
-- ------------------------------------------------------------
-- 使用方法：
--   打开 Supabase 控制台 → 左侧 SQL Editor → New query
--   → 把本文件全部内容粘贴进去 → 点 Run
--
-- 重复执行是安全的：本文件用了 if not exists / drop policy if exists，
-- 所以改完再跑一次不会报错，也不会清掉已有数据。
-- ============================================================


-- ============================================================
-- 一、words 表：单词库（所有用户共享的公共数据）
-- ============================================================
create table if not exists public.words (
  id                  bigint generated always as identity primary key,

  -- 单词本身。加 unique 是为了导入词库时能「按单词去重」：
  -- 同一个词重复导入不会产生两条记录，而是更新原来那条。
  word                text not null unique,

  phonetic            text,            -- 音标，例如 /əˈbændən/
  part_of_speech      text,            -- 词性，例如 v. / n. / adj.
  meaning             text not null,   -- 中文释义（必填，没有释义的词没用）
  example             text,            -- 英文例句
  example_translation text,            -- 例句的中文翻译

  -- 难度 1-5。check 是数据库层面的保险：就算程序写错，也插不进 6 或 0。
  difficulty          smallint not null default 3 check (difficulty between 1 and 5),

  created_at          timestamptz not null default now()
);

-- 让「按难度抽新词」这个查询更快（低难度优先学）
create index if not exists words_difficulty_idx on public.words (difficulty);


-- ============================================================
-- 二、user_word_progress 表：每个用户对每个单词的学习进度
-- ============================================================
create table if not exists public.user_word_progress (
  id                  bigint generated always as identity primary key,

  -- 这两列是「这个用户」和「这个单词」的指路牌。
  -- on delete cascade 的意思是：如果用户注销或单词被删，对应的进度记录
  -- 会自动一起删掉，不会留下没人认领的垃圾数据。
  user_id             uuid not null references auth.users (id) on delete cascade,
  word_id             bigint not null references public.words (id) on delete cascade,

  -- 掌握程度：0=不认识 1=模糊 2=认识 3=已掌握
  familiarity         smallint not null default 0 check (familiarity between 0 and 3),

  -- 连续答对次数。复习算法靠它决定 3/7/14/30 天阶梯。
  consecutive_correct integer not null default 0 check (consecutive_correct >= 0),

  review_count        integer not null default 0 check (review_count >= 0),   -- 复习总次数
  correct_count       integer not null default 0 check (correct_count >= 0),  -- 累计答对
  wrong_count         integer not null default 0 check (wrong_count >= 0),    -- 累计答错

  -- 用 timestamptz（带时区）而不是 timestamp：它记录的是一个「绝对时刻」。
  -- 这样你在电脑上排好的复习时间，手机上打开不会因为时区不同而错位。
  last_review_time    timestamptz,
  next_review_time    timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- 【重要】一个用户对一个单词只能有一条进度记录。
  -- 有了这个约束，代码里就能用 upsert（有则更新、无则插入）来保存进度，
  -- 不用先查再写 —— 既少一次请求，也不会出现重复行。
  unique (user_id, word_id)
);

-- 首页要查「我有哪些词今天该复习了」，这个索引专门服务那个查询
create index if not exists progress_user_next_review_idx
  on public.user_word_progress (user_id, next_review_time);


-- ============================================================
-- 三、自动维护 updated_at
-- ============================================================
-- 这段是一个「触发器」：每次某一行被修改时，数据库自动把 updated_at
-- 改成当前时间。放在数据库里做，就不怕哪天写代码时忘了更新它。
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_progress_updated_at on public.user_word_progress;
create trigger set_progress_updated_at
  before update on public.user_word_progress
  for each row
  execute function public.set_updated_at();


-- ============================================================
-- 四、行级安全策略（RLS）—— 本文件最关键的部分
-- ============================================================
-- 先说清楚 RLS 是什么：
-- Supabase 的数据库是「可以被浏览器直接访问」的。浏览器用的是公开密钥，
-- 任何人都能拿到。那怎么防止别人读到你的数据？
-- 靠的就是 RLS：数据库对每一行数据都检查一遍「你是谁、你有没有资格看」。
--
-- 关键点：RLS 是数据库层强制执行的，不是靠前端代码自觉。
-- 就算有人改了浏览器里的代码绕过界面，数据库依然会拒绝他。
--
-- 开启 RLS 后，默认是「全部拒绝」。必须显式写出允许的策略，
-- 数据才读得到。所以下面每一条策略都是在「开一个口子」。
-- ============================================================

alter table public.words enable row level security;
alter table public.user_word_progress enable row level security;


-- ---------- words 表：所有人都能读，谁都不能改 ----------
-- 单词释义是公共知识，不是隐私，所以允许未登录用户也能读
-- （这样连接诊断页在登录前就能验证数据库是否打通）。
drop policy if exists "单词：所有人可读" on public.words;
create policy "单词：所有人可读"
  on public.words
  for select
  to anon, authenticated
  using (true);

-- 没有任何 insert / update / delete 策略 = 任何人都改不了单词库。
-- 只能由你在 Supabase 控制台手动改。这是故意的。


-- ---------- user_word_progress 表：只能碰自己的数据 ----------
-- auth.uid() 是 Supabase 提供的函数，返回「当前登录用户的 ID」。
-- 它从请求携带的登录凭证里读取，客户端无法伪造。
--
-- 下面四条策略合起来的效果：
--   用户 A 无论用什么方式访问，都只能看到、只能修改 user_id = A 的行。
--   用户 B 登录后读不到 A 的任何一条记录。

drop policy if exists "进度：只能读自己的" on public.user_word_progress;
create policy "进度：只能读自己的"
  on public.user_word_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "进度：只能插入自己的" on public.user_word_progress;
create policy "进度：只能插入自己的"
  on public.user_word_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
  -- with check 的作用：连「插入时把 user_id 写成别人」都直接拒绝，
  -- 不只是拒绝读别人的数据。

drop policy if exists "进度：只能改自己的" on public.user_word_progress;
create policy "进度：只能改自己的"
  on public.user_word_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "进度：只能删自己的" on public.user_word_progress;
create policy "进度：只能删自己的"
  on public.user_word_progress
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================
-- 五、权限（和 RLS 是两回事，两个都要对才行）
-- ============================================================
-- 打个比方：权限是「能不能进这栋楼」，RLS 是「进去后能开哪几扇门」。
-- 两者缺一不可，所以这里都写清楚。
grant select on public.words to anon, authenticated;
revoke insert, update, delete on public.words from anon, authenticated;

grant select, insert, update, delete on public.user_word_progress to authenticated;
revoke all on public.user_word_progress from anon;
-- 从上面这条可以看出：未登录用户连「进度表」这扇门都进不去。


-- ============================================================
-- 六、自检查询（可选）
-- ============================================================
-- 跑完上面的语句后，可以单独执行下面这句，确认两张表都建好了：
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
--
-- 预期看到：user_word_progress、words
