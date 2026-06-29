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
export declare function openHistory(file: string): HistoryStore;
