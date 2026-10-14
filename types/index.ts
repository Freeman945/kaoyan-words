/**
 * 全项目共用的数据类型定义。
 *
 * 为什么要单独放一个文件？
 * 这些类型描述了「数据库里的一条记录长什么样」。页面、算法、数据库操作
 * 三边都引用同一份定义，就不会出现「这边叫 meaning、那边叫 definition」
 * 这种各写各的情况。
 *
 * 命名说明：这里故意沿用数据库的「下划线小写」风格（如 next_review_time），
 * 而不是驼峰式（nextReviewTime）。这样从数据库读出来的对象可以原样使用，
 * 不需要额外写一层转换代码 —— 对初学者来说少一层就少一处出错的地方。
 */

/**
 * 掌握程度。数字越大越熟。
 * 这个数字直接存在数据库里，所以绝对不能随意改动含义。
 */
export type Familiarity =
  | 0 // 不认识
  | 1 // 模糊
  | 2 // 认识
  | 3; // 已掌握

/** 用户在背单词页面上的三个选择 */
export type ReviewRating = "again" | "hard" | "good";

/** 掌握程度对应的中文，用于界面显示 */
export const FAMILIARITY_LABELS: Record<Familiarity, string> = {
  0: "不认识",
  1: "模糊",
  2: "认识",
  3: "已掌握",
};

/** 三个按钮对应的中文，用于界面显示 */
export const RATING_LABELS: Record<ReviewRating, string> = {
  again: "不认识",
  hard: "模糊",
  good: "认识",
};

/** words 表的一行：一个单词的静态信息（所有用户共享） */
export type Word = {
  id: number;
  word: string;
  phonetic: string | null;
  part_of_speech: string | null;
  meaning: string;
  example: string | null;
  example_translation: string | null;
  /** 难度 1-5，越大越难；用于安排学习顺序 */
  difficulty: number | null;
  created_at: string;
};

/**
 * user_word_progress 表的一行：某个用户对某个单词的学习进度。
 *
 * 注意 user_id 是 Supabase Auth 生成的用户 ID（UUID 字符串）。
 * 这张表是「用户私有数据」，靠数据库的行级安全策略（RLS）保证
 * A 用户读不到 B 用户的行。
 */
export type WordProgressRow = {
  id: number;
  user_id: string;
  word_id: number;
  familiarity: Familiarity;
  /**
   * 连续答对（点「认识」）的次数。
   *
   * 【为什么要在你给的表结构上加这个字段】
   * 你设计的 review_count / correct_count / wrong_count 都是「累计总量」，
   * 只能回答「一共答对过几次」，回答不了「最近连续答对了几次」。
   * 而 3天→7天→14天→30天 这个阶梯，恰恰是由「连续答对次数」决定的：
   * 中间只要错一次，阶梯就要从头开始。所以必须单独记一个连击数。
   */
  consecutive_correct: number;
  review_count: number;
  correct_count: number;
  wrong_count: number;
  /** 上次复习时间（ISO 字符串），从没复习过是 null */
  last_review_time: string | null;
  /** 下次该复习的时间（ISO 字符串）。如果 <= 现在，说明这个词今天该复习了 */
  next_review_time: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 一个单词 + 当前用户的进度，合并后的结果。
 * 背单词页面需要同时用到两者，所以用这个类型表示「拼好的数据」。
 * 如果用户还没学过这个词，progress 就是 null。
 */
export type WordWithProgress = Word & {
  progress: WordProgressRow | null;
};

/**
 * review_logs 表的一行：一次作答的流水记录。
 *
 * 这张表只增不改：每次点「不认识/模糊/认识」就插一行。
 * 它让「最近 7 天每天学了多少」能算准，也为将来的 AI 错词测试留下历史。
 */
export type ReviewLogRow = {
  id: number;
  user_id: string;
  word_id: number;
  /** 这次点了哪个按钮 */
  rating: ReviewRating;
  /** 作答之后的掌握程度 */
  familiarity_after: Familiarity;
  reviewed_at: string;
};

/**
 * weekly_report_log 表的一行：一次周报发送记录。
 *
 * 表上的唯一约束 (user_id, week_start) 是「一周只发一封」的保证，
 * 所以这里不需要额外的去重逻辑。
 * 建表语句：supabase/add-weekly-report-log.sql
 */
export type WeeklyReportLogRow = {
  id: number;
  user_id: string;
  /** 这一封周报覆盖的那一周的周一（YYYY-MM-DD） */
  week_start: string;
  sent_at: string;
};

/**
 * study_reminder_log 表的一行：一次晚间提醒的发送记录。
 *
 * 唯一约束 (user_id, reminder_date) 是「一天只提醒一次」的保证，
 * 所以定时任务重试也不会重复发。
 * 建表语句：supabase/add-study-reminder-log.sql
 */
export type StudyReminderLogRow = {
  id: number;
  user_id: string;
  /** 这条提醒是哪一天的（按北京时间的日期） */
  reminder_date: string;
  sent_at: string;
};

/**
 * 一次作答的保存结果。
 *
 * 【为什么用「返回对象」而不是「抛异常」表示失败】
 * 保存动作是在服务器上执行的（Server Action），报错信息经过网络传输后
 * 细节常常丢失，前端只能看到一个笼统的"服务器错误"。
 * 老老实实把结果当数据传回来，就能把「登录过期了」「数据库表还没建」
 * 这类具体原因原样显示给用户。
 */
export type SaveReviewResult =
  | { ok: true }
  | { ok: false; error: string };
