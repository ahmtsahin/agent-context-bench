import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepo, discoverContextFiles, generateOptimizedAgents, inferRepoSignals } from "./index.js";
const DEFAULT_CONDITIONS = ["none", "current", "optimized"];
const DEFAULT_TIMEOUT_MS = 600_000;
const COPY_IGNORE = new Set([".git", "node_modules", "dist", "build", "coverage", ".agent-context-bench"]);
// Run each task through the adapter under each context condition and measure
// whether the success command passes. "Success" is observed, not estimated:
// it is the exit status of the configured success command after the agent runs.
export function runBench(rootInput, options) {
    const root = path.resolve(rootInput);
    const conditions = options.conditions ?? DEFAULT_CONDITIONS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const successCommand = options.successCommand ?? inferRepoSignals(root).commands.test;
    const baseDir = options.workspaceRoot
        ? (fs.mkdirSync(options.workspaceRoot, { recursive: true }), options.workspaceRoot)
        : fs.mkdtempSync(path.join(os.tmpdir(), "acb-bench-"));
    const log = options.onProgress ?? (() => { });
    const results = [];
    for (const task of options.tasks) {
        const conditionResults = [];
        for (const condition of conditions) {
            log(`task ${task.id} [${condition}]`);
            const workspace = prepareWorkspace(root, task, condition, baseDir);
            try {
                const contextTokens = applyCondition(workspace, condition);
                const start = Date.now();
                const run = options.adapter.run({ prompt: task.prompt, workspace, condition, timeoutMs });
                const durationMs = Date.now() - start;
                const verification = runSuccessCommand(workspace, task.successCommand ?? successCommand, timeoutMs);
                conditionResults.push({
                    condition,
                    adapterOk: run.ok,
                    success: run.ok && verification.success,
                    durationMs,
                    contextTokens,
                    tokensUsed: run.tokensUsed,
                    note: combineNotes(run.ok ? undefined : `agent command failed${run.exitCode === undefined ? "" : ` (exit ${run.exitCode})`}`, verification.note)
                });
            }
            finally {
                cleanupWorkspace(root, workspace);
            }
        }
        results.push({ taskId: task.id, conditions: conditionResults });
    }
    if (!options.workspaceRoot) {
        try {
            fs.rmSync(baseDir, { recursive: true, force: true });
        }
        catch {
            // Best-effort cleanup of the temp workspace root.
        }
    }
    return summarize(root, options.adapter.name, conditions, results);
}
// Adapter that shells out to a user-provided command. The prompt is exposed via
// stdin and the AGENT_BENCH_* env vars; {prompt} and {workspace} placeholders in
// the command are substituted as a convenience.
export function commandAdapter(command, name = "command") {
    return {
        name,
        run({ prompt, workspace, condition, timeoutMs }) {
            const spawnOptions = {
                cwd: workspace,
                encoding: "utf8",
                timeout: timeoutMs,
                input: prompt,
                env: {
                    ...process.env,
                    AGENT_BENCH_PROMPT: prompt,
                    AGENT_BENCH_CONDITION: condition,
                    AGENT_BENCH_WORKSPACE: workspace
                }
            };
            let result;
            try {
                if (/\{(?:prompt|workspace)\}/.test(command)) {
                    const expand = (value) => value
                        .replace(/\{prompt\}/g, prompt)
                        .replace(/\{workspace\}/g, workspace);
                    const [executable, ...args] = parseCommandTemplate(command);
                    result = spawnSync(expand(executable), args.map(expand), spawnOptions);
                }
                else {
                    result = spawnSync(command, { ...spawnOptions, shell: true });
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    ok: false,
                    output: `agent command error: ${message}`
                };
            }
            const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
            return {
                ok: !result.error && result.status === 0,
                output,
                tokensUsed: parseReportedTokens(output),
                exitCode: result.status ?? undefined
            };
        }
    };
}
function summarize(root, adapter, conditions, results) {
    const successRate = {};
    const avgContextTokens = {};
    for (const condition of conditions) {
        const rows = results.map((result) => result.conditions.find((entry) => entry.condition === condition)).filter(Boolean);
        successRate[condition] = rows.length === 0 ? 0 : round(rows.filter((row) => row.success).length / rows.length, 4);
        avgContextTokens[condition] = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.contextTokens, 0) / rows.length);
    }
    const delta = (a, b) => successRate[a] === undefined || successRate[b] === undefined ? null : round((successRate[a] - successRate[b]) * 100, 2);
    return {
        adapter,
        generatedAt: new Date().toISOString(),
        root,
        conditions,
        tasks: results.length,
        successRate,
        avgContextTokens,
        deltas: {
            currentVsNone: delta("current", "none"),
            optimizedVsCurrent: delta("optimized", "current"),
            optimizedVsNone: delta("optimized", "none")
        },
        results
    };
}
function prepareWorkspace(root, task, condition, baseDir) {
    const workspace = path.join(baseDir, `${sanitize(task.id)}__${condition}`);
    fs.rmSync(workspace, { recursive: true, force: true });
    if (isGitRepo(root)) {
        const ref = task.baseCommit ?? "HEAD";
        try {
            execFileSync("git", ["worktree", "add", "--force", "--detach", workspace, ref], { cwd: root, stdio: "ignore" });
            return workspace;
        }
        catch {
            // Fall back to a plain copy if the ref is missing or worktrees are unavailable.
        }
    }
    copyTree(root, workspace);
    return workspace;
}
function cleanupWorkspace(root, workspace) {
    if (isGitRepo(root)) {
        try {
            execFileSync("git", ["worktree", "remove", "--force", workspace], { cwd: root, stdio: "ignore" });
        }
        catch {
            // Ignore; the directory removal below is the real cleanup.
        }
    }
    try {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
    catch {
        // Best-effort cleanup.
    }
}
// Mutate the workspace's context files for the condition and return the token
// footprint the agent would actually see.
function applyCondition(workspace, condition) {
    if (condition === "current") {
        return contextTokensFor(workspace);
    }
    if (condition === "optimized") {
        const hadRootClaudeMd = discoverContextFiles(workspace).some((file) => file.relativePath === "CLAUDE.md");
        const optimized = generateOptimizedAgents(analyzeRepo(workspace));
        removeContextFiles(workspace);
        fs.writeFileSync(path.join(workspace, "AGENTS.md"), optimized, "utf8");
        if (hadRootClaudeMd) {
            // Claude Code loads CLAUDE.md but not AGENTS.md, so repos that relied on a
            // root CLAUDE.md keep the optimized context visible via an import bridge.
            fs.writeFileSync(path.join(workspace, "CLAUDE.md"), "@AGENTS.md\n", "utf8");
        }
        return contextTokensFor(workspace);
    }
    removeContextFiles(workspace);
    return 0;
}
function contextTokensFor(workspace) {
    return discoverContextFiles(workspace).reduce((sum, file) => sum + file.tokenEstimate, 0);
}
function removeContextFiles(workspace) {
    for (const file of discoverContextFiles(workspace)) {
        try {
            fs.rmSync(file.absolutePath, { force: true });
        }
        catch {
            // Ignore files that cannot be removed in the workspace copy.
        }
    }
}
function runSuccessCommand(workspace, command, timeoutMs) {
    if (!command) {
        return { success: false, note: "no success command (pass --success or expose a test script)" };
    }
    const result = spawnSync(command, { cwd: workspace, shell: true, encoding: "utf8", timeout: timeoutMs });
    if (result.error) {
        return { success: false, note: `success command error: ${result.error.message}` };
    }
    return { success: result.status === 0 };
}
function isGitRepo(root) {
    return fs.existsSync(path.join(root, ".git"));
}
function copyTree(root, destination) {
    fs.cpSync(root, destination, {
        recursive: true,
        filter: (source) => {
            const name = path.basename(source);
            return !COPY_IGNORE.has(name);
        }
    });
}
function parseReportedTokens(output) {
    const match = output.match(/\bTOKENS?\b\s*[=:]\s*(\d+)/i);
    return match ? Number(match[1]) : undefined;
}
function parseCommandTemplate(command) {
    const args = [];
    let current = "";
    let quote;
    let tokenStarted = false;
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];
        if (quote) {
            if (char === quote) {
                quote = undefined;
            }
            else if (char === "\\" &&
                quote === "\"" &&
                command[index + 1] === "\"") {
                current += "\"";
                index += 1;
            }
            else {
                current += char;
            }
            tokenStarted = true;
            continue;
        }
        if (char === "\"" || char === "'") {
            quote = char;
            tokenStarted = true;
            continue;
        }
        if (/\s/.test(char)) {
            if (tokenStarted) {
                args.push(current);
                current = "";
                tokenStarted = false;
            }
            continue;
        }
        if (/[|&;<>]/.test(char)) {
            throw new Error("shell operators cannot be combined with {prompt} or {workspace}; use stdin or AGENT_BENCH_* variables instead");
        }
        const next = command[index + 1] ?? "";
        if (char === "\\" && /[\s"'\\]/.test(next)) {
            current += next;
            index += 1;
        }
        else {
            current += char;
        }
        tokenStarted = true;
    }
    if (quote) {
        throw new Error("unclosed quote in agent command");
    }
    if (tokenStarted) {
        args.push(current);
    }
    if (args.length === 0) {
        throw new Error("agent command is empty");
    }
    return args;
}
function combineNotes(...notes) {
    const present = notes.filter((note) => Boolean(note));
    return present.length > 0 ? present.join("; ") : undefined;
}
function sanitize(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
//# sourceMappingURL=bench.js.map