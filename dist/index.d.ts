export { renderDashboardReports } from "./dashboard.js";
export type Severity = "info" | "warn" | "error";
export type ReportFormat = "text" | "json" | "markdown" | "dashboard";
export type LoadScope = "always" | "deferred";
export interface ContextTotals {
    files: number;
    lines: number;
    bytes: number;
    tokenEstimate: number;
}
export interface AnalyzeOptions {
    maxLines?: number;
    maxBytes?: number;
    maxDepth?: number;
}
export interface ContextFile {
    absolutePath: string;
    relativePath: string;
    kind: string;
    loadScope: LoadScope;
    content: string;
    lineCount: number;
    byteLength: number;
    tokenEstimate: number;
}
export interface Issue {
    id: string;
    title: string;
    severity: Severity;
    category: string;
    message: string;
    suggestion: string;
    impact: number;
    file?: string;
    line?: number;
}
export interface RepoSignals {
    name: string;
    languages: string[];
    packageManager?: string;
    packageScripts: Record<string, string>;
    commands: {
        install?: string;
        test?: string;
        build?: string;
        lint?: string;
        typecheck?: string;
    };
}
export interface EffectEstimate {
    taskSuccessDeltaPct: number;
    tokenCostDeltaPct: number;
    filesExploredDeltaPct: number;
    commandCountDeltaPct: number;
    risk: string;
}
export interface ContextScopeSummary {
    label: string;
    description: string;
    score: number;
    totals: ContextTotals;
    effect: EffectEstimate;
    issues: Issue[];
}
export interface ContextFileSummary {
    name: string;
    path: string;
    kind: string;
    loadScope: LoadScope;
    score: number;
    lines: number;
    bytes: number;
    tokenEstimate: number;
    effect: EffectEstimate;
    issueCount: number;
    errorCount: number;
    warningCount: number;
    issues: Issue[];
}
export interface AnalysisResult {
    root: string;
    generatedAt: string;
    score: number;
    inventoryRiskScore: number;
    files: ContextFile[];
    issues: Issue[];
    repo: RepoSignals;
    totals: ContextTotals;
    effect: EffectEstimate;
    inventoryEffect: EffectEstimate;
    operationalWeights: {
        always: number;
        deferred: number;
    };
    skillReports: ContextFileSummary[];
    scopes: {
        always: ContextScopeSummary;
        deferred: ContextScopeSummary;
    };
}
export interface SerializableContextFile {
    path: string;
    kind: string;
    loadScope: LoadScope;
    lines: number;
    bytes: number;
    tokenEstimate: number;
}
export interface SerializableAnalysisResult extends Omit<AnalysisResult, "files"> {
    optimizedPath?: string;
    files: SerializableContextFile[];
}
export interface DashboardReportInput {
    label?: string;
    sourceFile?: string;
    result: SerializableAnalysisResult;
    agentsPreview?: string;
}
export interface GeneratedBenchTask {
    id: string;
    baseCommit: string;
    targetCommit: string;
    title: string;
    prompt: string;
    filesChanged: string[];
    successCriteria: string[];
}
export declare function analyzeRepo(rootInput?: string, options?: AnalyzeOptions): AnalysisResult;
export declare function discoverContextFiles(rootInput?: string, options?: AnalyzeOptions): ContextFile[];
export declare function inferRepoSignals(rootInput?: string): RepoSignals;
export declare function generateOptimizedAgents(result: AnalysisResult): string;
export declare function writeOptimizedAgents(result: AnalysisResult, outputPath?: string): string;
export declare function renderReport(result: AnalysisResult, format?: ReportFormat, optimizedPath?: string): string;
export declare function generateBenchFromGitHistory(rootInput?: string, options?: {
    limit?: number;
    scanCommits?: number;
}): GeneratedBenchTask[];
