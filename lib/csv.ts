/**
 * CSV 解析工具。
 *
 * 为什么不用现成的库？
 * 这个需求只有几十行，而且 CSV 的规则本身很值得理解（它比看起来麻烦）。
 * 自己写一份，你能看清楚每个字符是怎么被处理的；将来真需要更强的功能
 * （比如多行字段），再换库也不迟。
 *
 * 之所以抽成独立文件，是因为有两个地方要用：
 *   1. scripts/csv-to-sql.ts —— 把词库转成 SQL
 *   2. lib/words.ts —— 预览页面直接读词库
 */

/** 去掉 UTF-8 BOM（Excel 另存为 CSV 时会偷偷加这个字符） */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 解析 CSV 文本，返回二维数组：每一行是一个字段数组。
 *
 * 为什么不能简单 split(",") ？
 * 真实词库里可能出现本身带逗号的字段，那时 CSV 规定要用双引号包起来：
 *     "放弃，抛弃"
 * 直接 split 会把一个字段切成两个。所以必须实现标准规则：
 *   - 双引号「里面」的逗号和换行都不算分隔符
 *   - 连续两个双引号 "" 表示一个真正的双引号字符
 *   - \r\n 和 \n 都算换行（Windows 和 Mac/Linux 的区别）
 */
export function parseCsv(input: string): string[][] {
  const text = stripBom(input);

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (insideQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          // 连续两个双引号 → 一个真正的双引号字符
          currentField += '"';
          index += 2;
          continue;
        }
        // 单个双引号 → 引号区域结束
        insideQuotes = false;
        index += 1;
        continue;
      }
      // 引号内的任何字符都原样保留（包括逗号和换行）
      currentField += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      // Windows 的换行是 \r\n，\r 直接忽略，交给后面的 \n 处理
      index += 1;
      continue;
    }
    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      index += 1;
      continue;
    }

    currentField += char;
    index += 1;
  }

  // 文件末尾如果没有换行符，最后一行还没被推入数组
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}
