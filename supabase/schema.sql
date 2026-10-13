-- ============================================================
-- 考研英语背单词 —— 数据库表结构 + 安全策略
-- ------------------------------------------------------------
-- 使用方法：
--   打开 Supabase 控制台 → 左侧 SQL Editor → New query
--   → 把本文件全部内容粘贴进去 → 点 Run
--
-- 重复执行是安全的：本文件用了 if not exists / drop policy if exists，
-- 所以改完再跑一次不会报错，也不会清掉已有数据。
--
-- 阅读顺序：每张表都是「先建表 → 再讲它的安全策略」，
-- 这样一张表的所有规则都集中在一处，不用来回翻。
-- ============================================================


-- ============================================================
-- 名词解释：RLS（行级安全策略）
-- ------------------------------------------------------------
-- Supabase 的数据库可以被浏览器直接访问，而浏览器用的密钥是公开的，
-- 谁都能拿到。那怎么防止别人读到你的数据？
-- 靠的就是 RLS：数据库对每一行数据都检查一遍「你是谁、你有没有资格看」。
--
-- 关键点：RLS 是数据库层强制执行的，不是靠前端代码自觉。
-- 就算有人改了浏览器里的代码绕过界面，数据库依然会拒绝。
--
-- 开启 RLS 后默认是「全部拒绝」，必须显式写出允许的策略才读得到数据。
-- 所以下面每条策略都是在「开一个口子」。
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

alter table public.words enable row level security;

-- 单词释义是公共知识，不是隐私，所以允许未登录用户也能读
-- （这样连接诊断页在登录前就能验证数据库是否打通）。
drop policy if exists "单词：所有人可读" on public.words;
create policy "单词：所有人可读"
  on public.words
  for select
  to anon, authenticated
  using (true);

-- 注意：这里没有任何 insert / update / delete 策略。
-- 在 RLS 里「没有策略」= 拒绝。所以任何人都改不了单词库，
-- 只能由你在 Supabase 控制台手动改。这是故意的。

grant select on public.words to anon, authenticated;
-- 就算 Supabase 默认给了更多权限，这里也明确收回，只留只读。
revoke insert, update, delete on public.words from anon, authenticated;
-- TRUNCATE（清空整张表）不看 RLS，属于另一条路径，所以单独收回。
revoke truncate, references, trigger on public.words from anon, authenticated;


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
  -- 用户原本的设计里只有 review_count/correct_count/wrong_count 三个累计值，
  -- 它们回答不了「最近连续答对了几次」，而这个阶梯正是由连击数决定的。
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

alter table public.user_word_progress enable row level security;

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

grant select, insert, update, delete on public.user_word_progress to authenticated;
revoke all on public.user_word_progress from anon;
-- 从上面这条可以看出：未登录用户连「进度表」这扇门都进不去。
revoke truncate, references, trigger on public.user_word_progress from anon, authenticated;


-- ============================================================
-- 三、review_logs 表：每一次作答的流水记录
-- ------------------------------------------------------------
-- 【为什么需要这张表 —— 这是我对你给的表结构做的第二处补充】
--
-- user_word_progress 里只有一个 last_review_time，它保存的是「最近一次」
-- 复习时间。也就是说：你周一背了 abandon，周三又背了一次，那么周一那条
-- 记录就被覆盖掉了 —— 周一的那次学习在数据库里彻底消失了。
--
-- 结果就是：Dashboard 上「最近 7 天每天学了多少词」这个柱状图，用现有字段
-- 算不出来（只能算出「最近 7 天碰过的词总数」，那是两回事）。
--
-- 所以加一张流水表：每作答一次就插一行，永不修改。
-- 除了准确的每日统计，它还直接支撑你后面想做的 AI 功能：
--   「根据最近错词生成测试题」→ 需要知道哪些词在什么时候答错了
--   「今日薄弱词汇总结」      → 需要今天的完整作答记录
-- 这些都需要「历史」，而进度表只保留「现状」。
--
-- 代价很小：每次作答多插一行。一张几千行的表对 Postgres 来说微不足道。
-- ============================================================
create table if not exists public.review_logs (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  word_id            bigint not null references public.words (id) on delete cascade,

  -- 这次点了哪个按钮。用 check 限定取值，防止程序写进乱七八糟的值。
  rating             text not null check (rating in ('again', 'hard', 'good')),

  -- 作答之后的掌握程度，方便以后回看「这个词是怎么一步步变熟的」
  familiarity_after  smallint not null check (familiarity_after between 0 and 3),

  reviewed_at        timestamptz not null default now()
);

-- Dashboard 的每日统计要按「某人的某段时间」查，这个索引专门服务它
create index if not exists review_logs_user_time_idx
  on public.review_logs (user_id, reviewed_at desc);

alter table public.review_logs enable row level security;

drop policy if exists "流水：只能读自己的" on public.review_logs;
create policy "流水：只能读自己的"
  on public.review_logs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "流水：只能插入自己的" on public.review_logs;
create policy "流水：只能插入自己的"
  on public.review_logs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 【为什么故意不给 update / delete 策略】
-- 流水账的意义就在于「发生过的事不能改」。没有策略 = 拒绝，
-- 所以任何用户（包括你自己）都无法篡改或删除历史记录。
-- 这样统计数字永远可信。真要清空数据，在控制台手动执行即可。

grant select, insert on public.review_logs to authenticated;
revoke all on public.review_logs from anon;
revoke truncate, references, trigger on public.review_logs from anon, authenticated;


-- ============================================================
-- 四、取新词的函数
-- ------------------------------------------------------------
-- 【为什么这件事要交给数据库做，而不是在 JS 里过滤】
-- 「今天该学哪些新词」= 词库里所有词 − 我已经学过的词。
--
-- 看起来很简单，但如果先把「我学过的单词 id」全部拉到 JS 里、
-- 再拼成一个排除列表去查询，会有两个问题：
--   1. 学过 2000 个词时，这个排除列表会让请求地址长到几 KB，
--      而 PostgREST 是用 URL 传参的，有长度上限，可能直接失败；
--   2. 网络要来回传几千个 id，白白浪费流量和时间。
--
-- 写成数据库函数后，这些计算全在数据库内部完成（它有索引），
-- 只把最终结果传回来。词库从 40 个涨到 5000 个都不受影响。
--
-- security invoker 的意思是「按调用者的身份执行」，
-- 所以行级安全策略依然生效，不会因为这个函数就绕过安全检查。
-- ============================================================
create or replace function public.get_new_words(p_limit integer)
returns setof public.words
language sql
stable
security invoker
as $$
  select w.*
  from public.words w
  where not exists (
    select 1
    from public.user_word_progress p
    where p.word_id = w.id
      and p.user_id = auth.uid()
  )
  -- 先学简单的，同难度按加入顺序
  order by w.difficulty, w.id
  limit p_limit
$$;

grant execute on function public.get_new_words(integer) to authenticated;

-- 【为什么必须再 revoke 一次 from public】
-- PostgreSQL 在创建函数时，默认把「执行权限」授予一个叫 PUBLIC 的伪角色
-- —— 也就是"所有人"。只 revoke from anon 是不够的：anon 会通过 PUBLIC
-- 继续继承这个权限，等于没收回。
--
-- 这是我在你这个真实项目上验证发现的：只 revoke from anon 时，未登录访客
-- 依然能调用这个函数（它随后会因为读不到 user_word_progress 而报权限错误，
-- 拿不到任何数据，所以没有数据泄露；但"能调用"本身就是一道不必要的口子）。
revoke execute on function public.get_new_words(integer) from public;
grant execute on function public.get_new_words(integer) to authenticated;


-- ============================================================
-- 五、自检查询（可选）
-- ============================================================
-- 跑完上面的语句后，可以单独执行下面这句，确认表都建好了：
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
--
-- 预期看到：review_logs、user_word_progress、words
