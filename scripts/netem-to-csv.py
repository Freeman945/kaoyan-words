"""
把 exam-data/NETEMVocabulary 的考研词表转成本项目能用的格式。

数据来源：https://github.com/exam-data/NETEMVocabulary
  netem_full_list.json —— 5530 个考研词汇，按词频排序

⚠️ 许可证：CC BY-NC-SA 4.0（署名 · 非商业性使用 · 相同方式共享）
   - 个人自用没问题
   - 不能用于收费产品或商业服务
   - 分发时要注明来源，衍生作品要用同样的许可证

⚠️ 这份数据只有「单词 + 释义 + 词频 + 分类」，**没有音标、词性、例句**。
   所以导进去之后，单词卡上的音标和例句位置会是空的。
   这是数据源的限制，不是转换脚本的问题。

运行方式（用工作区自带的 Python）：
    python scripts/netem-to-csv.py <netem_full_list.json 的路径>
"""

import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "words-netem.csv")
SQL_PATH = os.path.join(ROOT, "supabase", "seed-netem.sql")

# CSV 的列顺序必须和 lib/words.ts 里的 WORD_CSV_COLUMNS 完全一致
CSV_HEADER = [
    "word",
    "phonetic",
    "part_of_speech",
    "meaning",
    "example",
    "example_translation",
    "difficulty",
]

# 每条 insert 放多少个词。太大容易让 SQL 编辑器卡住，
# 太小会产生几百条语句、又长又难读。
CHUNK_SIZE = 300


def sql_text(value):
    """把字符串转成 SQL 字符串字面量（单引号要写成两个）。"""
    return "'" + value.replace("'", "''") + "'"


def difficulty_from_rank(rank, total):
    """
    把词频排名换算成 1~5 的难度。

    排名越靠前 = 越常见 = 越简单。分五档，每档 20%。
    这只是个粗略依据，用来排序和筛选。
    """
    if total <= 0:
        return 3
    percentile = rank / total
    return min(5, max(1, int(percentile * 5) + 1))


def read_source(src):
    """读源 JSON，返回 (单词, 释义, 难度) 三元组的列表。"""
    with open(src, encoding="utf-8") as handle:
        payload = json.load(handle)

    # 顶层是 { "表名": [条目...] }
    table_name = next(iter(payload))
    entries = payload[table_name]
    total = len(entries)

    triples = []
    seen = set()
    skipped = 0

    for entry in entries:
        word = (entry.get("单词") or "").strip()
        meaning = (entry.get("释义") or "").strip()

        # 没单词或没释义的行没有价值
        if word == "" or meaning == "":
            skipped += 1
            continue

        # 同一份数据里可能有重复词，只留第一次（也就是词频最高的那次）
        key = word.lower()
        if key in seen:
            skipped += 1
            continue
        seen.add(key)

        rank = int(entry.get("序号") or len(triples) + 1)
        triples.append((word, meaning, difficulty_from_rank(rank, total)))

    return table_name, triples, skipped


def write_csv(triples):
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(CSV_HEADER)
        for word, meaning, difficulty in triples:
            # 音标 / 词性 / 例句 / 例句翻译：数据源没有，留空
            writer.writerow([word, "", "", meaning, "", "", difficulty])


def write_sql(triples):
    """
    生成可以直接粘贴执行的 SQL。

    用 insert ... select ... where not exists 的写法，好处是：
      - 重复执行不会产生重复数据
      - 不依赖 words 表上有没有 word 唯一约束
      - 不会碰到已有的学习进度（完全不删任何东西）
    """
    statements = []

    for start in range(0, len(triples), CHUNK_SIZE):
        chunk = triples[start : start + CHUNK_SIZE]
        value_lines = [
            f"  ({sql_text(word)}, {sql_text(meaning)}, {difficulty})"
            for word, meaning, difficulty in chunk
        ]
        statements.append(
            "\n".join(
                [
                    "insert into public.words (word, meaning, difficulty)",
                    "select v.word, v.meaning, v.difficulty",
                    "from (values",
                    ",\n".join(value_lines),
                    ") as v(word, meaning, difficulty)",
                    "where not exists (",
                    "  select 1 from public.words w where w.word = v.word",
                    ");",
                ]
            )
        )

    header = "\n".join(
        [
            "-- ============================================================",
            "--  考研词表（按词频排序）",
            "-- ============================================================",
            "--  由 scripts/netem-to-csv.py 自动生成，不要手动编辑。",
            "",
            "--  来源：https://github.com/exam-data/NETEMVocabulary",
            "--  许可证：CC BY-NC-SA 4.0（署名 · 非商业性使用 · 相同方式共享）",
            "--    → 个人自用可以；不能用于收费产品或商业服务。",
            "",
            "--  执行方式：Supabase 控制台 → SQL Editor → 粘贴 → Run",
            "--  可以重复执行：已存在的单词会自动跳过，也不会动你的学习进度。",
            "",
            "--  ⚠️ 数据源没有音标、词性和例句，导进去之后单词卡上这几处是空的。",
            "-- ============================================================",
            "",
        ]
    )

    with open(SQL_PATH, "w", encoding="utf-8") as handle:
        handle.write(header)
        handle.write("\n\n".join(statements))
        handle.write("\n")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("用法: python scripts/netem-to-csv.py <netem_full_list.json>")

    table_name, triples, skipped = read_source(sys.argv[1])

    print(f"数据表：{table_name}")
    print(f"有效 {len(triples)} 条，跳过 {skipped} 条（重复或缺释义）")

    write_csv(triples)
    print(f"写出 CSV：{CSV_PATH}  ({os.path.getsize(CSV_PATH):,} 字节)")

    write_sql(triples)
    chunks = (len(triples) + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"写出 SQL：{SQL_PATH}  ({os.path.getsize(SQL_PATH):,} 字节)")
    print(f"  共 {chunks} 条 insert，每条约 {CHUNK_SIZE} 个词")
    print("")
    print("下一步：把 supabase/seed-netem.sql 粘到 Supabase 的 SQL Editor 执行。")


if __name__ == "__main__":
    sys.exit(main())
