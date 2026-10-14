"""
把 LinXueyuanStdio/DictionaryData 的词典数据转成本项目能用的格式。

数据来源：https://github.com/LinXueyuanStdio/DictionaryData
  word.csv                70165 个单词（含英式/美式音标）
  word_translation.csv    103977 条中文释义
  book.csv                584 本单词书的清单
  relation_book_word.csv  书 ↔ 单词 的对应关系（106 MB）

许可证：Apache License 2.0 ✅
  - 个人、商用都可以
  - 需要保留版权声明（已写进 README）

用法：
  python scripts/dictdata-to-csv.py <解压后的目录>

产出：
  data/words-kaoyan.csv     本项目格式的 CSV
  supabase/seed-kaoyan.sql  可直接粘贴执行（可重复执行）
"""

import csv
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "words-kaoyan.csv")
SQL_PATH = os.path.join(ROOT, "supabase", "seed-kaoyan.sql")

# CSV 列顺序必须和 lib/words.ts 里的 WORD_CSV_COLUMNS 一致
CSV_HEADER = [
    "word",
    "phonetic",
    "part_of_speech",
    "meaning",
    "example",
    "example_translation",
    "difficulty",
]

CHUNK_SIZE = 300

# 用哪一本单词书。改这里就能换成别的词表。
# book.csv 里几本常见的（第一列就是 id）：
#   58b28425cbb2de3860e9e5b2  2017考研大纲词汇（黄皮书）  5581 词  ← 默认，最接近官方大纲
#   cfecdb276f634854f3ef915e  2015考研英语词汇红宝书      6753 词（含超纲词）
#   fe131d7f5a6b38b23cc96731  2016恋练有词考研英语词汇    5451 词
#   2b44928ae11fb9384c4cf387  2015考研词汇乱序版（俞敏洪）6997 词
BOOK_ID = "58b28425cbb2de3860e9e5b2"
BOOK_NAME = "2017考研大纲词汇（黄皮书）"

# 释义太长的话单词卡会很难看。超过这个长度就截断。
# 不是丢信息 —— 而是「一眼能看完」比「一字不漏」更重要。
MAX_MEANING_LEN = 100


def sql_text(value):
    return "'" + str(value).replace("'", "''") + "'"


def clean_meaning(text):
    """把释义里的多余空白压掉，太长就截断。"""
    cleaned = " ".join(text.split())
    if len(cleaned) <= MAX_MEANING_LEN:
        return cleaned
    return cleaned[:MAX_MEANING_LEN].rstrip() + "…"


def read_book_words(relation_path, book_id):
    """从 106 MB 的关系表里挑出这本书用到的所有单词 id。"""
    ids = set()
    with open(relation_path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            parts = line.rstrip("\n").split(">")
            # bv_id > bv_book_id > bv_voc_id > ...
            if len(parts) >= 3 and parts[1] == book_id:
                ids.add(parts[2])
    return ids


def map_difficulty(raw):
    """
    源数据的难度是 0~10，我们的表只允许 1~5（schema.sql 里的 check 约束）。

    ⚠️ 这一步不是「锦上添花」，是**必须的**：
    不转换的话，整条 insert 会因为违反 check 约束而失败，
    而且报错只指向某一行，很难看出是难度越界。
    （这个坑是靠 scripts/check-seed-sql.ts 在本地 PGlite 里跑一遍才发现的。）

    映射是线性的：0→1，5→3，10→5，然后夹到 1~5 以内。
    """
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return 3
    value = max(0, min(10, value))
    return max(1, min(5, 1 + round(value * 4 / 10)))


def read_words(word_path):
    """word.csv → {vc_id: (单词, 英式音标, 美式音标, 难度)}"""
    table = {}
    with open(word_path, encoding="utf-8", errors="replace") as handle:
        for index, line in enumerate(handle):
            if index == 0:
                continue  # 表头
            parts = line.rstrip("\n").split(">")
            # vc_id > vc_vocabulary > vc_phonetic_uk > vc_phonetic_us > vc_frequency > vc_difficulty > ...
            if len(parts) < 6:
                continue
            voc_id = parts[0]
            word = parts[1].strip()
            if word == "":
                continue
            table[voc_id] = (
                word,
                parts[2].strip(),
                parts[3].strip(),
                map_difficulty(parts[5]),
            )
    return table


def read_translations(translation_path):
    """word_translation.csv → {小写单词: 中文释义}"""
    table = {}
    with open(translation_path, encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            word = (row.get("word") or "").strip().lower()
            translation = (row.get("translation") or "").strip()
            if word != "" and translation != "" and word not in table:
                table[word] = translation
    return table


def write_csv(rows):
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(CSV_HEADER)
        writer.writerows(rows)


def write_sql(rows):
    """生成可重复执行的 SQL：insert ... select ... where not exists"""
    statements = []
    for start in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[start : start + CHUNK_SIZE]
        values = []
        for word, phonetic, _pos, meaning, _ex, _ex_t, difficulty in chunk:
            values.append(
                f"  ({sql_text(word)}, {sql_text(phonetic)}, "
                f"{sql_text(meaning)}, {difficulty})"
            )
        statements.append(
            "\n".join(
                [
                    "insert into public.words (word, phonetic, meaning, difficulty)",
                    "select v.word, v.phonetic, v.meaning, v.difficulty",
                    "from (values",
                    ",\n".join(values),
                    ") as v(word, phonetic, meaning, difficulty)",
                    "where not exists (",
                    "  select 1 from public.words w where w.word = v.word",
                    ");",
                ]
            )
        )

    header = "\n".join(
        [
            "-- ============================================================",
            f"--  考研词表：{BOOK_NAME}",
            "-- ============================================================",
            "--  由 scripts/dictdata-to-csv.py 自动生成，不要手动编辑。",
            "",
            "--  数据来源：https://github.com/LinXueyuanStdio/DictionaryData",
            "--  许可证：Apache License 2.0（个人、商用均可，需保留版权声明）",
            "",
            "--  执行方式：Supabase 控制台 → SQL Editor → 粘贴 → Run",
            "--  可以重复执行：已存在的单词会自动跳过，也不会动你的学习进度。",
            "",
            "--  ⚠️ 数据源没有例句，所以单词卡上的例句位置是空的。",
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
        raise SystemExit("用法: python scripts/dictdata-to-csv.py <解压后的目录>")

    src = sys.argv[1]
    relation = os.path.join(src, "relation_book_word.csv")
    words_path = os.path.join(src, "word.csv")
    translations_path = os.path.join(src, "word_translation.csv")
    for path in (relation, words_path, translations_path):
        if not os.path.exists(path):
            raise SystemExit(f"找不到文件：{path}")

    print(f"选用的单词书：{BOOK_NAME}  ({BOOK_ID})")

    vocab_ids = read_book_words(relation, BOOK_ID)
    print(f"这本书收录 {len(vocab_ids)} 个单词 id")

    words = read_words(words_path)
    print(f"词库共 {len(words)} 个单词（含音标）")

    translations = read_translations(translations_path)
    print(f"释义库共 {len(translations)} 条")

    rows = []
    no_translation = 0
    seen = set()

    for voc_id in sorted(vocab_ids):
        entry = words.get(voc_id)
        if entry is None:
            continue
        word, uk, us, difficulty = entry

        key = word.lower()
        if key in seen:
            continue
        seen.add(key)

        translation = translations.get(key)
        if translation is None:
            no_translation += 1
            continue

        # 音标优先用英式（国内教材通用），没有就用美式
        phonetic = uk if uk != "" else us

        rows.append(
            [
                word,
                phonetic,
                "",  # part_of_speech：释义里已经带了词性，单独拆容易拆错
                clean_meaning(translation),
                "",  # example：数据源没有
                "",  # example_translation：数据源没有
                difficulty,
            ]
        )

    print(f"可用 {len(rows)} 条，跳过 {no_translation} 条（查不到释义）")

    write_csv(rows)
    print(f"写出 CSV：{CSV_PATH}  ({os.path.getsize(CSV_PATH):,} 字节)")

    write_sql(rows)
    chunks = (len(rows) + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"写出 SQL：{SQL_PATH}  ({os.path.getsize(SQL_PATH):,} 字节，{chunks} 条语句)")
    print("")
    print("下一步：把 supabase/seed-kaoyan.sql 粘到 Supabase 的 SQL Editor 执行。")


if __name__ == "__main__":
    sys.exit(main())
