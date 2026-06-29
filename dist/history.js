import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const COLUMNS = [
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
export function openHistory(file) {
    try {
        return openSqliteHistory(file);
    }
    catch {
        return openJsonlHistory(jsonlPath(file));
    }
}
function openSqliteHistory(file) {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE IF NOT EXISTS runs (
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
    )`);
    const insert = db.prepare(`INSERT OR REPLACE INTO runs (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`);
    return {
        backend: "sqlite",
        file,
        add(record) {
            insert.run(...COLUMNS.map((column) => record[column] ?? null));
        },
        list(limit = 50) {
            const rows = db.prepare(`SELECT ${COLUMNS.join(", ")} FROM runs ORDER BY timestamp DESC LIMIT ?`).all(limit);
            return rows;
        },
        close() {
            db.close();
        }
    };
}
function openJsonlHistory(file) {
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
                .map((line) => JSON.parse(line));
            records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
            return records.slice(0, limit);
        },
        close() {
            // JSON Lines store keeps no open handle.
        }
    };
}
function jsonlPath(file) {
    return file.replace(/\.(db|sqlite|sqlite3)$/i, "") + ".jsonl";
}
//# sourceMappingURL=history.js.map