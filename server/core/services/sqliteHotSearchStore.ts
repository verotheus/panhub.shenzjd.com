import type { IHotSearchStore, HotSearchItem, HotSearchStats } from "./hotSearchStore";

const MAX_ENTRIES = 30;
const DEFAULT_DB_DIR = "./data";
const DEFAULT_DB_PATH = "./data/hot-searches.db";
const LAMBDA = 0.05;

function isForbidden(term: string): boolean {
  const forbiddenPatterns = [
    /政治|暴力|色情|赌博|毒品/i,
    /fuck|shit|bitch/i,
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(term));
}

function normalize(term: string): string | null {
  let t = term.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return null;
  if (t.length > 20) return null;
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
  return t || null;
}

export class SqliteHotSearchStore implements IHotSearchStore {
  private db: any;
  private isInitialized = false;
  private initFailed = false;
  private initPromise: Promise<void> | null = null;
  private dbPath: string;
  private dbDir: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
    this.dbDir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/")) || DEFAULT_DB_DIR;
    this.initPromise = this.init()
      .then(() => {
        this.isInitialized = true;
        this.initPromise = null;
      })
      .catch((err) => {
        console.log("[SqliteHotSearchStore] ❌ 初始化失败:", err instanceof Error ? err.message : err);
        this.initFailed = true;
        this.initPromise = null;
        throw err;
      });
  }

  private async init(): Promise<void> {
    const Database = (await import("better-sqlite3")).default;
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync(this.dbDir)) {
      mkdirSync(this.dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hot_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL DEFAULT 1,
        last_searched_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_score ON hot_searches(score DESC);
      CREATE INDEX IF NOT EXISTS idx_last_searched ON hot_searches(last_searched_at DESC);
    `);

    console.log("[SqliteHotSearchStore] ✅ SQLite 存储已初始化");
  }

  private async waitForInit(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initFailed) return;
    if (this.initPromise) await this.initPromise;
  }

  async recordSearch(term: string, now: number): Promise<void> {
    await this.waitForInit();
    const normalized = normalize(term);
    if (!normalized) return;
    if (isForbidden(normalized)) return;

    const existing = this.db.prepare("SELECT score FROM hot_searches WHERE term = ?").get(normalized);
    if (existing) {
      this.db.prepare("UPDATE hot_searches SET score = score + 1, last_searched_at = ? WHERE term = ?").run(now, normalized);
    } else {
      this.db.prepare("INSERT INTO hot_searches (term, score, last_searched_at, created_at) VALUES (?, 1, ?, ?)").run(normalized, now, now);
    }

    await this.cleanupOldEntries(MAX_ENTRIES);
  }

  async getHotSearches(limit: number): Promise<HotSearchItem[]> {
    await this.waitForInit();
    const rows = this.db.prepare(`
      SELECT term, score, last_searched_at, created_at,
        score * exp(-0.05 * ((? - last_searched_at) / 86400000.0)) as decayed_score
      FROM hot_searches
      ORDER BY decayed_score DESC
      LIMIT ?
    `).all(Date.now(), Math.min(limit, MAX_ENTRIES));

    return rows.map((row: any, index: number) => ({
      term: row.term,
      score: row.score,
      lastSearched: row.last_searched_at,
      createdAt: row.created_at,
      rank: index + 1,
      displayScore: Math.round(row.decayed_score * 100) / 100,
    }));
  }

  async cleanupOldEntries(maxEntries: number): Promise<void> {
    this.db.prepare(`
      DELETE FROM hot_searches WHERE id NOT IN (
        SELECT id FROM hot_searches ORDER BY score DESC, last_searched_at DESC LIMIT ?
      )
    `).run(maxEntries);
  }

  async clearHotSearches(): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    this.db.prepare("DELETE FROM hot_searches").run();
    return { success: true, message: "热搜记录已清除" };
  }

  async deleteHotSearch(term: string): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    const result = this.db.prepare("DELETE FROM hot_searches WHERE term = ?").run(term);
    if (result.changes > 0) {
      return { success: true, message: `热搜词 "${term}" 已删除` };
    }
    return { success: false, message: "热搜词不存在" };
  }

  async getStats(): Promise<HotSearchStats> {
    await this.waitForInit();
    const total = this.db.prepare("SELECT COUNT(*) as count FROM hot_searches").get().count;
    const topTerms = await this.getHotSearches(10);
    return { total, topTerms };
  }

  getDbSize(): number {
    try {
      const { existsSync, statSync } = require("fs");
      if (existsSync(this.dbPath)) {
        return Math.round((statSync(this.dbPath).size / (1024 * 1024)) * 100) / 100;
      }
    } catch {}
    return 0;
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
