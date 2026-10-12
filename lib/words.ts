/**
 * 单词数据的读写。
 *
 * 现在这里只有一个函数：从 CSV 读测试词库。
 * 它服务于两件事：
 *   1. 预览页面（还没连数据库时，先让你看到背单词界面长什么样）
 *   2. 导入脚本（把 CSV 转成 SQL）
 *
 * 【重要】正式运行时，单词是从 Supabase 的 words 表里读的（阶段 4 建的）。
 * 这个文件读的是本地 CSV 文件，只在「还没配数据库」时用。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Word } from "@/types";
import { parseCsv } from "./csv";

/**
 * CSV 的列顺序。
 * scripts/csv-to-sql.ts 也引用这份定义，所以改了这里就等于两边一起改了。
 */
export const WORD_CSV_COLUMNS = [
  "word",
  "phonetic",
  "part_of_speech",
  "meaning",
  "example",
  "example_translation",
  "difficulty",
] as const;

/** 测试词库在项目里的位置（相对于项目根目录） */
export const SEED_CSV_RELATIVE_PATH = "data/words-seed.csv";

/**
 * 读取 data/words-seed.csv，转成 Word 数组。
 *
 * 出错时会抛出带原因的错误（表头不对 / 字段数不对），
 * 调用方应该捕获它并显示成友好提示，而不是让页面直接崩掉。
 */
export function loadSeedWords(): Word[] {
  const filePath = resolve(process.cwd(), SEED_CSV_RELATIVE_PATH);
  const rows = parseCsv(readFileSync(filePath, "utf8"));

  if (rows.length === 0) {
    throw new Error(`${SEED_CSV_RELATIVE_PATH} 是空文件。`);
  }

  const header = rows[0].map((column) => column.trim());
  const headerMatches =
    header.length === WORD_CSV_COLUMNS.length &&
    WORD_CSV_COLUMNS.every((expected, i) => header[i] === expected);

  if (!headerMatches) {
    throw new Error(
      `CSV 表头不对。\n期望：${WORD_CSV_COLUMNS.join(",")}\n实际：${header.join(",")}`,
    );
  }

  const words: Word[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const fields = rows[i];

    // 跳过空行
    if (fields.length === 1 && fields[0].trim() === "") continue;

    if (fields.length !== WORD_CSV_COLUMNS.length) {
      throw new Error(
        `第 ${i + 1} 行有 ${fields.length} 个字段，应该是 ${WORD_CSV_COLUMNS.length} 个。`,
      );
    }

    const [
      word,
      phonetic,
      partOfSpeech,
      meaning,
      example,
      exampleTranslation,
      difficultyText,
    ] = fields;

    words.push({
      // CSV 里没有 id 这一列，预览时用行号顶替。
      // 数据库里的 words 表有真正的自增 id（阶段 4 建表时就定义了）。
      id: i,
      word,
      phonetic,
      part_of_speech: partOfSpeech,
      meaning,
      example,
      example_translation: exampleTranslation,
      difficulty: Number(difficultyText),
      created_at: "",
    });
  }

  return words;
}
