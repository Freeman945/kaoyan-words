/**
 * 「现在有一批候选词，谁更应该先出现」—— 基于遗忘概率的出词算法。
 *
 * ══════════════════════════════════════════════════════════════
 * 【职责边界：三个文件各管一件事】
 *
 *   lib/spaced-repetition.ts   「答完以后，下次什么时候该复习」
 *                               → 艾宾浩斯阶梯，决定一个词**是否进入**复习区域
 *   lib/word-selection.ts      「区域内有一批词，谁先出现」      ← 本文件
 *                               → 遗忘概率加权，决定**次序**
 *   lib/progress.ts             去数据库取数据、调上面两个、返回排好的队列
 *
 * 刻意不合并成一个大文件：时间调度和优先级排序是两件事，
 * 以后想调整复习阶梯，不该被迫动出词概率。
 *
 * 【为什么需要这个文件】
 * 按 next_review_time 从早到晚排队，会出现一个问题：
 * 一百个词同时逾期时，先出现谁其实是「谁的表更大」决定的 ——
 * 一个错了很多次的词和一个只错过一次的词，排序上没有任何区别。
 *
 * 这里改成：逾期程度、错误率、遗忘概率、熟练度一起算一个权重，
 * 权重越大越可能先出现。但**不完全是随机**（见下面「稳定性」）。
 * ══════════════════════════════════════════════════════════════
 *
 * 【两条铁律】
 *   1. 纯函数：时间由参数传入，不碰数据库、不在内部 new Date()。
 *      所以能被测试穷举，也方便以后调试。
 *   2. 任何异常输入都必须有 fallback：null 时间、间隔为负、次数为 0 ——
 *      绝不能产生 NaN / Infinity / 0 或负的权重。
 *      （一个 NaN 权重会让整个排序崩掉，而且很难查。）
 */

/* ════════════════════════════════════════════════════════════
 * 可调参数
 * 每个常量都在注释里写明「调大/调小会发生什么」，方便以后自己改。
 * ════════════════════════════════════════════════════════════ */

/**
 * 一个词恰好走到计划复习时间时，期望还记得的比例。
 *
 * 0.60 意味着：到点复习时，你大概还记得六成、忘掉四成。
 * 调小 → 允许更晚才复习（间隔更宽松，但忘得更多）
 * 调大 → 更早复习（记更牢，但复习量大）
 */
export const TARGET_RETENTION = 0.6;

/**
 * 遗忘概率在权重里的指数（放大「快忘了」的差异）。
 *
 * 1.0 → (BASE + F) 线性
 * 1.4 → 越接近必忘，权重涨得越快（当前值）
 * 调大 → 快忘的词更强势地插队
 */
export const FORGETTING_POWER = 1.4;

/**
 * 基础权重。
 *
 * 作用：让「遗忘概率接近 0」（刚复习完）的词也保留一点点出现机会，
 * 不至于权重变成 0（0 权重在抽样里等于永远不出现）。
 * 调大 → 熟练词的干扰变多；调小 → 几乎只出快忘的词。
 */
export const BASE_WEIGHT = 0.05;

/**
 * 错误率的影响强度。
 *
 * 权重会乘以 (1 + ERROR_WEIGHT × 错误率)。
 * 1.0 → 错误率 0→1 时，权重最多翻倍
 * 调大 → 经常答错的词更优先（但注意别盖过遗忘概率）
 */
export const ERROR_WEIGHT = 1.0;

/**
 * 逾期程度的影响强度。
 *
 * 权重会乘以 (1 + OVERDUE_WEIGHT × 逾期比)，逾期比已被封顶在 MAX_OVERDUE_RATIO。
 * 0.75 → 严重逾期最多 ×2.5
 */
export const OVERDUE_WEIGHT = 0.75;

/**
 * 逾期比的上限。
 *
 * 逾期比 = 逾期时长 ÷ 计划间隔。超过这个上限就按上限算 ——
 * 否则一个逾期 50 天的词会把权重推到极端，永远霸占队列。
 */
export const MAX_OVERDUE_RATIO = 2;

/**
 * 熟练度的影响强度（温和修正）。
 *
 * masteryFactor = 1 + STAR_WEIGHT × (1 − 星级/5)
 *   0.5 → 0 星 ×1.5，3 星 ×1.2，5 星 ×1.0
 *
 * 刻意只做温和修正：不能让它压过遗忘概率，
 * 否则「低星词」会天天刷屏，而已经快忘的高星词反而排不上。
 */
export const STAR_WEIGHT = 0.5;

/**
 * 真题词频的修正幅度。
 *
 *   frequencyFactor = 0.8 + 0.4 × 词频
 *     词频 0 → ×0.8    词频 0.5 → ×1.0    词频 1 → ×1.2
 *
 * 写成「1 − 权重/2 + 权重 × 词频」即可，本质就是 0.8 + 0.4×词频。
 *
 * ⚠️ 当前仓库**没有**可用的真题词频数据（词库只有单词/音标/释义），
 *    所以现阶段 frequencyFactor 恒为 1。
 *    等以后有了可靠数据再启用，绝不凭空编造「考研出现次数」。
 */
export const FREQUENCY_WEIGHT = 0.4;

/**
 * 「严重逾期 → 必须优先」的门槛（相对计划间隔的倍数）。
 *
 * 逾期超过计划间隔的这个倍数，就进入 guaranteedDue 集合，
 * 排在所有普通候选词前面 —— 防止概率排序把该复习的词饿死。
 *
 * 例：计划间隔 1 天、已经逾期 3 天 → 逾期比 3 > 2 → 强制优先。
 */
export const STARVATION_OVERDUE_RATIO = 2;

/**
 * 无法算出合理间隔时的兜底间隔（毫秒）。
 *
 * 用在：last_review_time 或 next_review_time 缺失、
 *       或者 next <= last（间隔为 0 或负数）的时候。
 * 取 1 天：一个中性假设，既不会让逾期比爆掉，也不会让分母变 0。
 */
export const FALLBACK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/* ════════════════════════════════════════════════════════════
 * 类型
 * ════════════════════════════════════════════════════════════ */

/**
 * 参与排序的一个候选词。
 *
 * 字段刻意用「驼峰」而不是数据库的下划线名：这是算法层的输入，
 * 由 progress.ts 从数据库行转换过来。这样算法文件不依赖数据库结构。
 */
export type ReviewCandidate = {
  wordId: number;
  /** 上次复习时间（ISO）。从没复习过是 null */
  lastReviewTime: string | null;
  /** 计划的下次复习时间（ISO）。缺失是 null */
  nextReviewTime: string | null;
  /** 累计复习次数 */
  reviewCount: number;
  /** 累计答对次数 */
  correctCount: number;
  /** 累计答错次数 */
  wrongCount: number;
  /** 当前星级 0~5（由调用方用 starsOf() 算好传进来） */
  stars: number;
  /**
   * 真题词频 0~1（可选，未来扩展）。
   * 当前仓库没有这个数据 → 传 undefined，frequencyFactor 就是 1。
   */
  frequencyScore?: number | null;
};

/** 一个候选词的完整评分明细 —— 调试时直接打印这个对象就能看懂为什么它排在前面 */
export type ReviewPriority = {
  /** 当前预计还记得的概率 R，0~1 */
  retention: number;
  /** 遗忘概率 F = 1 − R，0~1 */
  forgettingProbability: number;
  /** 平滑后的错误率 E，0~1 */
  errorRate: number;
  /** 逾期比（已封顶到 MAX_OVERDUE_RATIO），用于权重 */
  overdueRatio: number;
  /** 逾期比（未封顶），用于「饿死保护」判定 */
  rawOverdueRatio: number;
  /** 熟练度修正因子 */
  masteryFactor: number;
  /** 真题词频修正因子（当前恒为 1） */
  frequencyFactor: number;
  /** 最终权重，保证 finite 且 > 0 */
  weight: number;
  /** 是否属于「严重逾期，必须优先」 */
  starving: boolean;
};

/* ════════════════════════════════════════════════════════════
 * 工具：安全的数值处理
 * ════════════════════════════════════════════════════════════ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 解析 ISO 时间，失败返回 null（绝不返回 NaN 时间戳） */
function parseTime(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 算出这个候选词的「计划复习间隔」。
 *
 * 正常情况 = next_review_time − last_review_time。
 * 缺失或非正数时回退到 FALLBACK_INTERVAL_MS —— 保证后面所有除法安全。
 */
export function plannedIntervalMs(candidate: ReviewCandidate): number {
  const last = parseTime(candidate.lastReviewTime);
  const next = parseTime(candidate.nextReviewTime);
  if (last === null || next === null) return FALLBACK_INTERVAL_MS;

  const interval = next - last;
  return Number.isFinite(interval) && interval > 0
    ? interval
    : FALLBACK_INTERVAL_MS;
}

/* ════════════════════════════════════════════════════════════
 * 各项因素的独立计算
 * 拆成小函数是为了能单独测试每一项 —— 混在一起就分不清是谁影响的。
 * ════════════════════════════════════════════════════════════ */

/**
 * 当前记忆保持率 R（0~1）。
 *
 * 模型：R(t) = exp(−t / tau)，其中 tau = −I / ln(TARGET_RETENTION)
 * 代入后等价于：R = TARGET_RETENTION ^ (t / I)
 *
 *   t = 0    → R = 1        （刚复习完，一定记得）
 *   t = I    → R = 0.6      （正好到计划复习时间）
 *   t = 2I   → R = 0.36     （逾期一倍间隔）
 *
 * 用 pow 而不是 exp 是等价的，但少见一次除法，也就不容易出现精度问题。
 */
export function retentionAt(
  elapsedMs: number,
  intervalMs: number,
  target: number = TARGET_RETENTION,
): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;

  // 还没到上次复习时间（时钟异常）→ 当作「没忘」
  if (elapsedMs <= 0) return 1;

  return clamp(Math.pow(target, elapsedMs / intervalMs), 0, 1);
}

/**
 * 平滑后的错误率 E。
 *
 *   E = (wrong + 1) / (reviewCount + 2)
 *
 * 加 1 / 加 2 是拉普拉斯平滑：一次没答过时 E = 1/2，
 * 答过 1 次错 1 次时 E = 2/3（而不是 100%）。
 * 这样样本少的词不会被错误地判成「一定不会」或「一定会」。
 */
export function smoothedErrorRate(
  wrongCount: number,
  reviewCount: number,
): number {
  const wrong = Number.isFinite(wrongCount) ? Math.max(0, wrongCount) : 0;
  const reviews = Number.isFinite(reviewCount) ? Math.max(0, reviewCount) : 0;
  return clamp((wrong + 1) / (reviews + 2), 0, 1);
}

/**
 * 逾期比（未封顶）。
 *
 *   还没到期 → 0
 *   已逾期   → (now − next) / 计划间隔
 *
 * 返回值可能很大（逾期 100 倍间隔就是 100），所以调用方需要自己决定封顶。
 */
export function rawOverdueRatio(
  nextReviewTime: string | null,
  intervalMs: number,
  now: Date,
): number {
  const next = parseTime(nextReviewTime);
  if (next === null) return 0;

  const overdueMs = now.getTime() - next;
  if (overdueMs <= 0) return 0;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return MAX_OVERDUE_RATIO;

  return overdueMs / intervalMs;
}

/**
 * 熟练度修正因子。
 *
 *   masteryFactor = 1 + STAR_WEIGHT × (1 − 星级/5)
 *     0 星 → 1.5    3 星 → 1.2    5 星 → 1.0
 */
export function masteryFactorOf(stars: number): number {
  const safeStars = clamp(stars, 0, 5);
  return 1 + STAR_WEIGHT * (1 - safeStars / 5);
}

/**
 * 真题词频修正因子。
 *
 *   frequencyFactor = (1 − FREQUENCY_WEIGHT/2) + FREQUENCY_WEIGHT × 词频
 *
 * FREQUENCY_WEIGHT = 0.4 时：词频 0 → 0.8，0.5 → 1.0，1 → 1.2。
 * 写成「1 − 权重/2」而不是「1 − 权重」，是为了让 1.0 落在词频 0.5 上 ——
 * 也就是「中等词频 = 不修正」，高/低频各自上下浮动。
 *
 * 没有词频数据（undefined / null）时返回 1 —— 不影响任何权重。
 */
export function frequencyFactorOf(score: number | null | undefined): number {
  if (score === null || score === undefined) return 1;
  const safe = clamp(score, 0, 1);
  return clamp(1 - FREQUENCY_WEIGHT / 2 + FREQUENCY_WEIGHT * safe, 0.5, 1.5);
}

/* ════════════════════════════════════════════════════════════
 * 主函数：算出优先级明细
 * ════════════════════════════════════════════════════════════ */

/**
 * 算一个候选词的完整优先级。
 *
 * 最终权重：
 *
 *   weight = (BASE + F) ^ FORGETTING_POWER
 *          × (1 + ERROR_WEIGHT   × E)
 *          × (1 + OVERDUE_WEIGHT × O)
 *          × masteryFactor
 *          × frequencyFactor
 *
 * 为什么不把这几项相乘后直接当概率：因为它们是「相对倾向」，
 * 真正的概率要在一批候选词里归一化（见 rankReviewCandidates）。
 */
export function calculateReviewPriority(
  candidate: ReviewCandidate,
  now: Date,
): ReviewPriority {
  const intervalMs = plannedIntervalMs(candidate);
  const last = parseTime(candidate.lastReviewTime);

  /*
   * 从没复习过的词：不存在「保持率」这个概念。
   * 这里给 retention = 0（即遗忘概率 1），让它有较高的基础权重 ——
   * 但注意：新词根本不会走到这个函数（它们由 DAILY_NEW_LIMIT 单独处理），
   * 这里只是防御，保证不产生 NaN。
   */
  const elapsedMs = last === null ? 0 : now.getTime() - last;
  const retention = last === null ? 0 : retentionAt(elapsedMs, intervalMs);
  const forgettingProbability = clamp(1 - retention, 0, 1);

  const errorRate = smoothedErrorRate(
    candidate.wrongCount,
    candidate.reviewCount,
  );

  const raw = rawOverdueRatio(candidate.nextReviewTime, intervalMs, now);
  const overdueRatio = clamp(raw, 0, MAX_OVERDUE_RATIO);

  const masteryFactor = masteryFactorOf(candidate.stars);
  const frequencyFactor = frequencyFactorOf(candidate.frequencyScore);

  const rawWeight =
    Math.pow(BASE_WEIGHT + forgettingProbability, FORGETTING_POWER) *
    (1 + ERROR_WEIGHT * errorRate) *
    (1 + OVERDUE_WEIGHT * overdueRatio) *
    masteryFactor *
    frequencyFactor;

  // 最后一道保险：权重必须有限且正数
  const weight =
    Number.isFinite(rawWeight) && rawWeight > 0
      ? rawWeight
      : Number.MIN_VALUE;

  return {
    retention,
    forgettingProbability,
    errorRate,
    overdueRatio,
    rawOverdueRatio: Number.isFinite(raw) ? raw : 0,
    masteryFactor,
    frequencyFactor,
    weight,
    starving: raw > STARVATION_OVERDUE_RATIO,
  };
}

/* ════════════════════════════════════════════════════════════
 * 稳定加权排序（deterministic weighted ordering）
 * ════════════════════════════════════════════════════════════ */

/**
 * 把一个字符串映射到 (0, 1) 区间的伪随机数。
 *
 * 用的是 FNV-1a 哈希 —— 短、快、不需要依赖库。
 * 关键是**确定性**：同样的字符串永远得到同样的数，
 * 所以「同一个用户 + 同一天 + 同一个词」的排序不会因为刷新页面而变。
 *
 * 返回值刻意避开 0 和 1 两个端点：
 *   · 0 会让 Efraimidis-Spirakis 的 key 恒为 0（永远排最后）
 *   · 1 会让 key 恒为 1（永远排最前）
 */
export function stableUnitInterval(seed: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // FNV prime，用 imul 保持 32 位整数运算
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 转成无符号，再映射到 (0,1)
  const unsigned = hash >>> 0;
  return (unsigned + 0.5) / 4294967296;
}

/**
 * 算一个候选词的排序键（Efraimidis-Spirakis weighted random sampling）。
 *
 *   key = u ^ (1 / weight)
 *
 * 性质：key 越大越先出现；权重大 → 1/weight 小 → key 更接近 1 → 更容易排前面。
 * 按 key 从大到小排序就等价于「按权重无放回加权抽样」，
 * 而且不需要真的随机 —— u 是确定性的。
 *
 * 为什么不用 array.sort(() => Math.random() - 0.5)：
 *   1. 那个写法在多数引擎里分布不均匀（不是真正的洗牌）
 *   2. 每次刷新都变，用户会发现顺序全乱，体验很差
 */
export function weightedShuffleKey(weight: number, u: number): number {
  const safeWeight = Number.isFinite(weight) && weight > 0
    ? weight
    : Number.MIN_VALUE;
  const safeU = clamp(u, Number.MIN_VALUE, 1);
  return Math.pow(safeU, 1 / safeWeight);
}

/** 排序后的一项（保留明细，方便调试和展示「为什么它排前面」） */
export type RankedCandidate = {
  candidate: ReviewCandidate;
  priority: ReviewPriority;
};

/**
 * 给一批候选词排序。
 *
 * 两条规则：
 *   ① 严重逾期的词（starving）整体排在普通词前面 —— 防止被概率饿死
 *   ② 同一组内部按加权抽样键从大到小排
 *
 * @param candidates 候选词
 * @param now 当前时间（由调用方传入）
 * @param seedPrefix 稳定种子的前缀，例如 `${userId}|${北京日期}`
 */
export function rankReviewCandidates(
  candidates: readonly ReviewCandidate[],
  now: Date,
  seedPrefix: string,
): RankedCandidate[] {
  const ranked = candidates.map((candidate) => {
    const priority = calculateReviewPriority(candidate, now);
    const u = stableUnitInterval(`${seedPrefix}|${candidate.wordId}`);
    return {
      candidate,
      priority,
      key: weightedShuffleKey(priority.weight, u),
    };
  });

  ranked.sort((a, b) => {
    // ① 饿死保护：严重逾期的排前面
    if (a.priority.starving !== b.priority.starving) {
      return a.priority.starving ? -1 : 1;
    }
    // ② 组内按加权键从大到小
    if (b.key !== a.key) return b.key - a.key;
    // ③ 完全打平时按 wordId 兜底，保证顺序稳定（排序必须是确定性的）
    return a.candidate.wordId - b.candidate.wordId;
  });

  return ranked.map(({ candidate, priority }) => ({ candidate, priority }));
}

/**
 * 把权重归一化成概率（用于展示/调试：这个候选词出现的概率是多少）。
 * 注意：实际排序用的是加权抽样键，不是直接按概率取最大值。
 */
export function normalizeWeights(priorities: readonly ReviewPriority[]): number[] {
  const total = priorities.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    // 全 0 或异常时均分，保证不会出现 NaN
    const even = priorities.length > 0 ? 1 / priorities.length : 0;
    return priorities.map(() => even);
  }
  return priorities.map((item) => item.weight / total);
}

/** 供外部显示用：把毫秒间隔说成「几分钟」 */
export function minutesFromMs(ms: number): number {
  return Math.round(ms / MINUTE_MS);
}
