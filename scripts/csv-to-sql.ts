/**
 * 把 CSV 词库转换成可以粘贴进 Supabase 的 SQL 文件。
 *
 * 为什么需要这个脚本？
 * 以后你要导入几千个考研词汇，不可能一个一个手敲。这个脚本负责：
 *   读 CSV → 逐行检查格式 → 生成 SQL → 写进 supabase/seed.sql
 * 然后你把生成的 seed.sql 粘贴到 Supabase 的 SQL Editor 里跑一次就行。
 *
 * 用法：
 *   npm run import:words                        # 用默认的 data/words-seed.csv
 *   npm run import:words -- data/kaoyan-5000.csv   # 换成自己的词库文件
 *
 * CSV 格式（第一行必须是表头，顺序不能变）：
 *   word,phonetic,part_of_speech,meaning,example,example_translation,difficulty
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "../lib/csv";
import { WORD_CSV_COLUMNS } from "../lib/words";

/**
 * CSV 表头，必须一字不差。
 * 具体的列定义放在 lib/words.ts —— 因为「预览页面」也要用同一份定义，
 * 两边各写一遍迟早会写歪。
 */
const EXPECTED_HEADER = WORD_CSV_COLUMNS;

/** 每条 insert 语句最多带多少行数据。太大可能超出数据库的参数上限，所以分批。 */
const BATCH_SIZE = 500;

// CSV 解析函数已经搬到 lib/csv.ts，这样预览页面（lib/words.ts）也能复用同一份实现。

/** 把字符串转成 SQL 里的字符串字面量，并转义单引号（防止 SQL 注入/语法错误） */
function toSqlText(value: string): string {
  if (value === "") return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

type WordRecord = {
  word: string;
  phonetic: string;
  part_of_speech: string;
  meaning: string;
  example: string;
  example_translation: string;
  difficulty: number;
};

/**
 * 校验并转换一行数据。
 * 出错时抛出带行号的中文提示 —— 几千行的词库里，没有行号根本找不到问题。
 */
function toWordRecord(fields: string[], lineNumber: number): WordRecord {
  if (fields.length !== EXPECTED_HEADER.length) {
    throw new Error(
      `第 ${lineNumber} 行有 ${fields.length} 个字段，应该是 ${EXPECTED_HEADER.length} 个。` +
        `\n该行内容：${fields.join(" | ")}` +
        `\n常见原因：某个字段里混进了英文逗号。如果确实需要逗号，请用双引号把该字段包起来。`,
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

  if (word.trim() === "") {
    throw new Error(`第 ${lineNumber} 行的 word 是空的。`);
  }
  if (meaning.trim() === "") {
    throw new Error(`第 ${lineNumber} 行（${word}）的 meaning 是空的。`);
  }

  const difficulty = Number(difficultyText);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    throw new Error(
      `第 ${lineNumber} 行（${word}）的 difficulty 是「${difficultyText}」，` +
        `必须是 1-5 的整数。`,
    );
  }

  return {
    word: word.trim(),
    phonetic,
    part_of_speech: partOfSpeech,
    meaning,
    example,
    example_translation: exampleTranslation,
    difficulty,
  };
}

/** 把一批单词生成一条 insert 语句 */
function buildInsertStatement(batch: WordRecord[]): string {
  const values = batch
    .map(
      (w) =>
        `  (${toSqlText(w.word)}, ${toSqlText(w.phonetic)}, ${toSqlText(
          w.part_of_speech,
        )}, ${toSqlText(w.meaning)}, ${toSqlText(w.example)}, ${toSqlText(
          w.example_translation,
        )}, ${w.difficulty})`,
    )
    .join(",\n");

  return `insert into public.words
  (word, phonetic, part_of_speech, meaning, example, example_translation, difficulty)
values
${values}
on conflict (word) do update set
  phonetic            = excluded.phonetic,
  part_of_speech      = excluded.part_of_speech,
  meaning             = excluded.meaning,
  example             = excluded.example,
  example_translation = excluded.example_translation,
  difficulty          = excluded.difficulty;`;
}

function main(): void {
  const inputPath = resolve(process.cwd(), process.argv[2] ?? "data/words-seed.csv");
  const outputPath = resolve(process.cwd(), process.argv[3] ?? "supabase/seed.sql");

  console.log(`读取：${inputPath}`);
  const rows = parseCsv(readFileSync(inputPath, "utf8"));

  if (rows.length === 0) {
    throw new Error("CSV 是空的。");
  }

  // 校验表头
  const header = rows[0].map((h) => h.trim());
  const headerMatches =
    header.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((expected, i) => header[i] === expected);

  if (!headerMatches) {
    throw new Error(
      `CSV 表头不对。\n期望：${EXPECTED_HEADER.join(",")}\n实际：${header.join(",")}`,
    );
  }

  // 逐行转换（跳过空行）
  const words: WordRecord[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const fields = rows[i];
    if (fields.length === 1 && fields[0].trim() === "") continue; // 空行
    words.push(toWordRecord(fields, i + 1)); // i+1 = 真实行号（表头是第 1 行）
  }

  if (words.length === 0) {
    throw new Error("CSV 里除了表头没有任何单词。");
  }

  // 检查重复单词：同一个词出现两次会导致 insert 冲突
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const w of words) {
    const key = w.word.toLowerCase();
    if (seen.has(key)) duplicates.push(w.word);
    else seen.set(key, 1);
  }
  if (duplicates.length > 0) {
    throw new Error(
      `CSV 里有重复单词：${[...new Set(duplicates)].join("、")}\n请去重后再导入。`,
    );
  }

  // 分批生成 insert
  const statements: string[] = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    statements.push(buildInsertStatement(words.slice(i, i + BATCH_SIZE)));
  }

  const fileContent = [
    "-- ============================================================",
    "-- 本文件由 scripts/csv-to-sql.ts 自动生成，请不要手动修改。",
    "-- 重新生成：npm run import:words",
    `-- 单词数量：${words.length}`,
    "--",
    "-- 用法：把本文件全部内容粘贴到 Supabase 的 SQL Editor 里执行。",
    "-- 重复执行是安全的：同一个单词会更新，不会重复插入。",
    "-- ============================================================",
    "",
    statements.join("\n\n"),
    "",
  ].join("\n");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, fileContent, "utf8");

  console.log(`✅ 成功解析 ${words.length} 个单词`);
  console.log(`   生成了 ${statements.length} 条 insert 语句`);
  console.log(`写入：${outputPath}`);
}

main();
