-- ============================================================
-- 【仅供本地测试使用，不要粘贴到 Supabase】
-- ------------------------------------------------------------
-- 这个文件的作用是「假装我们有一个 Supabase 环境」。
--
-- 为什么需要它？
-- schema.sql 里用到了几样东西，是 Supabase 帮我们提前建好的，
-- 普通 PostgreSQL 里没有：
--   * auth 这个 schema
--   * auth.users 表（登录用户都存这里）
--   * auth.uid() 函数（返回当前登录用户 ID）
--   * anon / authenticated 这两个角色
--   * 默认权限（Supabase 会自动给新表授予权限，再由 RLS 收窄）
--
-- 本地测试用的 PostgreSQL（PGlite）没有这些，所以先把这个「替身」建起来，
-- 然后才能把真正的 schema.sql 原封不动地跑一遍，验证表和策略都写得对。
--
-- 这样做的价值：在你还沒注册 Supabase 之前，就能确认
-- 「用户 A 绝对看不到用户 B 的数据」这条规则是真的成立，
-- 而不是等到上线才发现策略写错了。
-- ============================================================

-- ---------- 1. auth schema 与用户表 ----------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- ---------- 2. 三个角色 ----------
-- Supabase 用它们区分请求身份：
--   anon          = 未登录访客
--   authenticated = 已登录用户
--   service_role  = 服务器端管理密钥，绕过 RLS
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- ---------- 3. 默认权限 ----------
-- 这里刻意模仿 Supabase 的宽松默认值（新建的表默认给 anon/authenticated
-- 全部权限），因为只有这样，schema.sql 里那些「明确收回权限」的语句
-- 才真的被考验到。如果这里一开始就什么都不给，测试是测不出问题的。
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- ---------- 4. auth.uid() ----------
-- 简化版替身：从会话变量里读当前用户 ID。
-- 真实 Supabase 是从请求携带的 JWT 里解析，并且会校验签名 ——
-- 所以真实环境比这里更安全，客户端无法伪造。
-- 测试里我们用 set_config 手动设置这个变量，来扮演不同的登录用户。
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
