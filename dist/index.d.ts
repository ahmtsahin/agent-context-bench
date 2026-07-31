export { renderDashboardReports } from "./dashboard.js";
export * from "./bench.js";
export * from "./history.js";
export type Severity = "info" | "warn" | "error";
export type ReportFormat = "text" | "json" | "markdown" | "dashboard";
export type LoadScope = "always" | "scoped" | "deferred";
export type AnalysisStatus = "configured" | "not-configured";
export type RiskLevel = "not-applicable" | "low" | "moderate" | "high" | "critical";
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
    ignoreDirs?: string[];
    tokenizer?: (text: string) => number;
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
/**
 * Directional signals derived from static rules, not measured agent outcomes.
 * Use `run-bench` when causal or percentage claims are needed.
 */
export interface HeuristicSignals {
    methodology: "static-heuristic";
    overallRisk: RiskLevel;
    outcomeRisk: RiskLevel;
    tokenOverheadRisk: RiskLevel;
    explorationOverheadRisk: RiskLevel;
    commandOverheadRisk: RiskLevel;
    primaryRisk: string;
}
export interface ContextScopeSummary {
    label: string;
    description: string;
    score: number | null;
    totals: ContextTotals;
    signals: HeuristicSignals;
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
    signals: HeuristicSignals;
    issueCount: number;
    errorCount: number;
    warningCount: number;
    issues: Issue[];
}
export interface AnalysisResult {
    root: string;
    generatedAt: string;
    status: AnalysisStatus;
    score: number | null;
    inventoryScore: number | null;
    files: ContextFile[];
    issues: Issue[];
    repo: RepoSignals;
    totals: ContextTotals;
    signals: HeuristicSignals;
    inventorySignals: HeuristicSignals;
    operationalWeights: {
        always: number;
        scoped: number;
        deferred: number;
    };
    skillReports: ContextFileSummary[];
    scopes: {
        always: ContextScopeSummary;
        scoped: ContextScopeSummary;
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
    verified?: boolean;
}
export declare function analyzeRepo(rootInput?: string, options?: AnalyzeOptions): AnalysisResult;
export declare function discoverContextFiles(rootInput?: string, options?: AnalyzeOptions): ContextFile[];
export declare function inferRepoSignals(rootInput?: string): RepoSignals;
export declare function generateAgentsCandidate(result: AnalysisResult): string;
/** @deprecated Use generateAgentsCandidate; this output is a candidate, not a proven optimization. */
export declare function generateOptimizedAgents(result: AnalysisResult): string;
export declare function writeAgentsCandidate(result: AnalysisResult, outputPath?: string): string;
/** @deprecated Use writeAgentsCandidate; this output is a candidate, not a proven optimization. */
export declare function writeOptimizedAgents(result: AnalysisResult, outputPath?: string): string;
export declare function renderReport(result: AnalysisResult, format?: ReportFormat, optimizedPath?: string): string;
interface BaselineSummaryBase {
    label?: string;
    score: number;
    totals: {
        tokenEstimate: number;
    };
}
export type BaselineSummary = BaselineSummaryBase & ({
    inventoryScore: number;
    inventoryRiskScore?: number;
} | {
    inventoryScore?: number;
    inventoryRiskScore: number;
});
export declare function renderBaselineComparison(current: AnalysisResult, baseline: BaselineSummary, format?: ReportFormat): string;
export declare function generateBenchFromGitHistory(rootInput?: string, options?: {
    limit?: number;
    scanCommits?: number;
}): GeneratedBenchTask[];
