import { loggers } from "../core/utils/logger";

/** 同一关键词在此时间窗口内只打印一次日志 */
const DEDUP_WINDOW_MS = 3000;

const recentSearches = new Map<string, number>();

/** 去重搜索日志：同一关键词在 DEDUP_WINDOW_MS 内只输出一条 */
export function logSearchOnce(kw: string, meta: Record<string, any>) {
  const now = Date.now();
  const last = recentSearches.get(kw);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  recentSearches.set(kw, now);

  // 清理过期条目，防止内存泄漏
  if (recentSearches.size > 200) {
    for (const [key, ts] of recentSearches) {
      if (now - ts > DEDUP_WINDOW_MS) recentSearches.delete(key);
    }
  }

  loggers.api.info(`搜索: "${kw}"`, meta);
}
