export type BenchCondition = "none" | "current" | "optimized";
export interface BenchTaskInput {
    id: string;
    prompt: string;
    baseCommit?: string;
    successCommand?: string;
    successCriteria?: string[];
    filesChanged?: string[];
}
export interface AdapterRunInput {
    prompt: string;
    workspace: string;
    condition: BenchCondition;
    timeoutMs: number;
}
export interface AdapterRunResult {
    ok: boolean;
    output: string;
    tokensUsed?: number;
    exitCode?: number;
}
export interface AgentAdapter {
    name: string;
    run(input: AdapterRunInput): AdapterRunResult;
}
export interface ConditionResult {
    condition: BenchCondition;
    adapterOk: boolean;
    success: boolean;
    durationMs: number;
    contextTokens: number;
    tokensUsed?: number;
    note?: string;
}
export interface TaskBenchResult {
    taskId: string;
    conditions: ConditionResult[];
}
export interface BenchSummary {
    adapter: string;
    generatedAt: string;
    root: string;
    conditions: BenchCondition[];
    tasks: number;
    successRate: Record<string, number>;
    avgContextTokens: Record<string, number>;
    deltas: {
        currentVsNone: number | null;
        optimizedVsCurrent: number | null;
        optimizedVsNone: number | null;
    };
    results: TaskBenchResult[];
}
export interface RunBenchOptions {
    adapter: AgentAdapter;
    tasks: BenchTaskInput[];
    conditions?: BenchCondition[];
    successCommand?: string;
    timeoutMs?: number;
    workspaceRoot?: string;
    onProgress?: (message: string) => void;
}
export declare function runBench(rootInput: string, options: RunBenchOptions): BenchSummary;
export declare function commandAdapter(command: string, name?: string): AgentAdapter;
