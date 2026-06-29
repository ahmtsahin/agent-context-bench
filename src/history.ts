import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface HistoryRecord {
  runId: string;
  timestamp: string;
  root: string;
  adapter: string;
  tasks: number;
  successNone: number | null;
  successCurrent: number | null;
  successOptimized: number | null;
  contextScore: number | null;
  summaryJson: string;
}

export interface HistoryStore {
  backend: "sqlite" | "jsonl";
  file: string;
  add(record: HistoryRecord): void;
  list(limit?: number): HistoryRecord[];
  close(): void;
}

const COLUMNS: Array<keyof HistoryRecord> = [
  "runId",
  "timestamp",
  "root",
  "adapter",
  "tasks",
  "successNone",
  "successCurrent",
  "successOptimized",
  "contextScore",
  "summaryJson"
];

// Prefer the built-in SQLite store (Node >= 22.5); fall back to a dependency-free
// JSON Lines file on older runtimes so history still works everywhere.
export function openHistory(file: string): HistoryStore {
  try {
    return openSqliteHistory(file);
  } catch {
    return openJsonlHistory(jsonlPath(file));
  }
}

function openSqliteHistory(file: string): HistoryStore {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
      close(): void;
    };
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    `CREATE TABLE IF NOT EXISTS runs (
      runId TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      root TEXT NOT NULL,
      adapter TEXT NOT NULL,
      tasks INTEGER NOT NULL,
      successNone REAL,
      successCurrent REAL,
      successOptimized REAL,
      contextScore REAL,
      summaryJson TEXT NOT NULL
    )`
  );
  const insert = db.prepare(`INSERT OR REPLACE INTO runs (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`);
  return {
    backend: "sqlite",
    file,
    add(record) {
      insert.run(...COLUMNS.map((column) => record[column] ?? null));
    },
    list(limit = 50) {
      const rows = db.prepare(`SELECT ${COLUMNS.join(", ")} FROM runs ORDER BY timestamp DESC LIMIT ?`).all(limit);
      return rows as HistoryRecord[];
    },
    close() {
      db.close();
    }
  };
}

function openJsonlHistory(file: string): HistoryStore {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    backend: "jsonl",
    file,
    add(record) {
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    },
    list(limit = 50) {
      if (!fs.existsSync(file)) {
        return [];
      }
      const records = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as HistoryRecord);
      records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return records.slice(0, limit);
    },
    close() {
      // JSON Lines store keeps no open handle.
    }
  };
}

function jsonlPath(file: string): string {
  return file.replace(/\.(db|sqlite|sqlite3)$/i, "") + ".jsonl";
}
