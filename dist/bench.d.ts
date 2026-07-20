export type BenchCondition = "none" | "current" | "optimized";
export interface BenchTaskInput {
    id: string;
    prompt: string;
    baseCommit?: string;
    targetCommit?: string;
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
export interface ConditionContextMetrics {
    goldFiles: string[];
    editedFiles: string[];
    exploredFiles: string[];
    editRecall: number | null;
    editPrecision: number | null;
    editF1: number | null;
    exploredRecall: number | null;
    exploredPrecision: number | null;
    exploredF1: number | null;
}
export interface ConditionResult {
    condition: BenchCondition;
    adapterOk: boolean;
    success: boolean;
    durationMs: number;
    contextTokens: number;
    tokensUsed?: number;
    contextMetrics?: ConditionContextMetrics;
    note?: string;
}
export interface TaskBenchResult {
    taskId: string;
    conditions: ConditionResult[];
}
export interface BenchConditionMetricsSummary {
    tasksWithGold: number;
    editRecall: number | null;
    editPrecision: number | null;
    editF1: number | null;
    exploredRecall: number | null;
    exploredPrecision: number | null;
    exploredF1: number | null;
}
export interface BenchSummary {
    adapter: string;
    generatedAt: string;
    root: string;
    conditions: BenchCondition[];
    tasks: number;
    successRate: Record<string, number>;
    avgContextTokens: Record<string, number>;
    avgDurationMs: Record<string, number>;
    efficiency: Record<string, number | null>;
    contextMetrics: Record<string, BenchConditionMetricsSummary>;
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
export interface TaskVerification {
    taskId: string;
    baseFails: boolean | null;
    targetPasses: boolean | null;
    verified: boolean;
    note?: string;
}
export interface VerifyBenchTasksOptions {
    successCommand?: string;
    timeoutMs?: number;
    onProgress?: (message: string) => void;
}
export declare function verifyBenchTasks(rootInput: string, tasks: BenchTaskInput[], options?: VerifyBenchTasksOptions): TaskVerification[];
