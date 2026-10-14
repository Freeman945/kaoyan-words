/**
 * 数据库的类型描述。
 *
 * 【这个文件解决什么问题】
 * Supabase 的客户端默认是「无类型」的：`supabase.from("words").select("*")`
 * 返回的东西在 TypeScript 眼里是 any。这意味着：
 *   - 列名写错（比如把 word_id 写成 wordId）编译器不会报错，
 *     要等到运行时页面崩了才发现；
 *   - 关联查询 `words(*)` 这种写法对不对，也只能靠跑一次来验证。
 *
 * 把这个类型补上之后，上面这些错误会在「编译阶段」就被指出来。
 * 相当于让 TypeScript 帮你把每条 SQL 都检查一遍。
 *
 * 【正式项目里这个文件怎么来的】
 * 官方有一条命令能连到你的数据库，自动扫描表结构生成这个文件：
 *     npx supabase gen types typescript --project-id 你的项目id > types/database.ts
 * 等你注册好 Supabase，可以用那条命令替换本文件，结果会更准确。
 * 现在这份是照着 supabase/schema.sql 手写的，字段与建表语句一一对应。
 *
 * 【为什么这些 Row 类型必须用 type 定义，不能用 interface】
 * TypeScript 有个细节：interface 不能赋值给 Record<string, unknown>
 * （因为 interface 没有隐式索引签名），而 type 别名可以。
 * Supabase 的内部类型要求每张表都满足 Record<string, unknown>，
 * 所以这里（以及 types/index.ts）一律用 type。
 */
import type {
  ReviewLogRow,
  WeeklyReportLogRow,
  Word,
  WordProgressRow,
} from "@/types";

/**
 * 自增主键和时间戳都是数据库自动生成的，插入时可以不填。
 * 用这个工具类型把「必填」变成「可选」，避免每个表都手写一遍。
 */
type WithGeneratedColumns<Row, Generated extends keyof Row> = Omit<
  Row,
  Generated
> &
  Partial<Pick<Row, Generated>>;

export type Database = {
  public: {
    Tables: {
      /** 单词库。所有人可读，谁都不能写。 */
      words: {
        Row: Word;
        Insert: WithGeneratedColumns<Word, "id" | "created_at">;
        Update: Partial<WithGeneratedColumns<Word, "id" | "created_at">>;
        // words 表没有被其他表引用，所以没有反向关系
        Relationships: [];
      };

      /** 每个用户对每个单词的学习进度。只能读写自己的。 */
      user_word_progress: {
        Row: WordProgressRow;
        Insert: WithGeneratedColumns<
          WordProgressRow,
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          WithGeneratedColumns<WordProgressRow, "id" | "created_at" | "updated_at">
        >;
        /*
         * 【这段声明是干什么的】
         * 它告诉 TypeScript：user_word_progress 通过 word_id 指向 words.id。
         *
         * 有了它，代码里写 .select("*, words(*)") 时编译器才认识 "words"
         * 是什么，也才能推断出返回结果里会多一个 words 字段。
         * 如果这里不写、或者把 referencedRelation 写成别的表名，
         * 那句关联查询就会直接报类型错误 —— 这正是我们想要的效果。
         *
         * 对应建表语句里的：
         *   word_id bigint not null references public.words (id)
         */
        Relationships: [
          {
            foreignKeyName: "user_word_progress_word_id_fkey";
            columns: ["word_id"];
            isOneToOne: false;
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };

      /** 每次作答的流水。只能追加，不能改也不能删。 */
      review_logs: {
        Row: ReviewLogRow;
        Insert: WithGeneratedColumns<ReviewLogRow, "id" | "reviewed_at">;
        Update: Partial<WithGeneratedColumns<ReviewLogRow, "id" | "reviewed_at">>;
        Relationships: [
          {
            foreignKeyName: "review_logs_word_id_fkey";
            columns: ["word_id"];
            isOneToOne: false;
            referencedRelation: "words";
            referencedColumns: ["id"];
          },
        ];
      };

      /**
       * 周报发送记录。
       * 建表语句在 supabase/add-weekly-report-log.sql。
       * 表上有一个唯一约束 (user_id, week_start)，用于保证「一周只发一封」。
       */
      weekly_report_log: {
        Row: WeeklyReportLogRow;
        Insert: WithGeneratedColumns<
          WeeklyReportLogRow,
          "id" | "sent_at"
        >;
        Update: Partial<
          WithGeneratedColumns<WeeklyReportLogRow, "id" | "sent_at">
        >;
        Relationships: [];
      };
    };

    /** 本项目没有用到数据库视图 */
    Views: { [_ in never]: never };

    /** 数据库函数（在 schema.sql 里定义的那些） */
    Functions: {
      /**
       * 取「我还没学过的新词」。
       * Args 是传入参数的名字和类型，Returns 是返回的东西。
       * 注意参数名必须和 SQL 里的形参一致（p_limit）。
       */
      get_new_words: {
        Args: { p_limit: number };
        Returns: Word[];
      };
    };
  };
};
