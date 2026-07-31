# Programmatic API

The package exposes its public ESM API from `agent-context-bench` and ships
TypeScript declarations.

```js
import {
  analyzeRepo,
  generateAgentsCandidate,
  renderReport
} from "agent-context-bench";

const result = analyzeRepo(".", {
  maxLines: 250,
  maxBytes: 12_000,
  ignoreDirs: ["fixtures"]
});

if (result.status === "not-configured") {
  console.log("No agent context is configured.");
} else {
  console.log({
    operationalScore: result.score,
    inventoryScore: result.inventoryScore,
    risk: result.signals.overallRisk,
    tokens: result.totals.tokenEstimate
  });
}

const markdown = renderReport(result, "markdown");
const candidate = generateAgentsCandidate(result);
```

All current analysis functions are synchronous. `analyzeRepo` reads the target
tree but does not modify it or call a model.

## Analysis types

The most useful exports are:

- `analyzeRepo(root?, options?) → AnalysisResult`
- `discoverContextFiles(root?, options?) → ContextFile[]`
- `inferRepoSignals(root?) → RepoSignals`
- `renderReport(result, format?, optimizedPath?) → string`
- `generateAgentsCandidate(result) → string`
- `writeAgentsCandidate(result, outputPath?) → string`
- `renderBaselineComparison(result, baseline, format) → string`
- `renderDashboardReports(inputs, options?) → string`

The older `generateOptimizedAgents` and `writeOptimizedAgents` names remain as
deprecated compatibility aliases. Prefer the candidate-named exports: generated
text always requires repository review and is not guaranteed to be optimal.
`writeAgentsCandidate` defaults to `AGENTS.starter.md` for a not-configured
result and `AGENTS.optimized.md` for a configured result.
Pass `{ generatedAt: "<ISO timestamp>" }` as the dashboard options when a
reproducible generated artifact is required; otherwise the build time is used.

`AnalysisResult.status` narrows score behavior:

```ts
type AnalysisStatus = "configured" | "not-configured";

interface AnalysisResult {
  status: AnalysisStatus;
  score: number | null;
  inventoryScore: number | null;
  signals: HeuristicSignals;
  inventorySignals: HeuristicSignals;
  // files, issues, scopes, totals, repo, skillReports, ...
}
```

Scores are `null` when no usable supported context exists (missing files or
only empty placeholders). Do not coerce them to zero or 100. Static signals are categorical and carry
`methodology: "static-heuristic"`; they are not measured runtime deltas.

Pass a tokenizer callback to replace the built-in token estimate:

```js
const result = analyzeRepo(".", {
  tokenizer(text) {
    return myTokenizer.encode(text).length;
  }
});
```

The callback keeps the library independent of any tokenizer package. The CLI's
`--exact-tokens` option separately loads optional `o200k_base` support.

## Benchmark API

The root export also includes the benchmark types and functions from
`dist/bench.js`:

- `runBench(root, options) → BenchSummary`
- `commandAdapter(command, name?) → AgentAdapter`
- `verifyBenchTasks(root, tasks, options?) → TaskVerification[]`
- `BenchTaskInput`, `BenchCondition`, `AgentAdapter`, and result/metric types

Minimal command-adapter example:

```js
import { commandAdapter, runBench } from "agent-context-bench";

const summary = runBench(".", {
  adapter: commandAdapter("my-agent --prompt-from-stdin", "my-agent"),
  tasks: [
    {
      id: "focused-regression",
      prompt: "Fix the failing parser regression without editing tests.",
      successCommand: "npm test -- parser"
    }
  ],
  conditions: ["none", "current", "optimized"],
  timeoutMs: 600_000,
  onProgress: console.error
});

console.log(summary.successRate, summary.contextMetrics);
```

`runBench` is synchronous and launches commands. `commandAdapter` invokes a
platform shell when the command has no `{prompt}` or `{workspace}` placeholder.
Only pass trusted commands. For tighter control, provide your own
`AgentAdapter` implementation:

```ts
interface AgentAdapter {
  name: string;
  run(input: {
    prompt: string;
    workspace: string;
    condition: "none" | "current" | "optimized";
    timeoutMs: number;
  }): {
    ok: boolean;
    output: string;
    tokensUsed?: number;
    exitCode?: number;
  };
}
```

The adapter must finish before returning. `output` is also used for best-effort
explored-file extraction, so preserve structured path-bearing transcript data
when possible.

## History API

`openHistory(file)` returns a SQLite-backed store where the runtime supports
`node:sqlite`, with a JSON Lines fallback otherwise:

```js
import { openHistory } from "agent-context-bench";

const store = openHistory(".agent-context-bench/history.db");
try {
  console.log(store.backend, store.list(10));
} finally {
  store.close();
}
```

Callers create `HistoryRecord` values explicitly before `store.add(record)`;
the higher-level CLI handles that conversion for normal benchmark runs.

## Compatibility policy

The project follows semantic versioning and records public changes in
[CHANGELOG.md](../CHANGELOG.md). While the package is `0.x`:

- patch releases are intended to be backward-compatible fixes;
- minor releases may evolve exported TypeScript interfaces, report JSON, and
  CLI output when needed to correct the model;
- documented deprecations are preferred when a practical compatibility bridge
  exists (for example legacy baseline fields);
- undocumented files under `dist/` or `src/` are not public entry points even
  though source is included in the package.

Consumers that parse JSON or compile against exact interfaces should pin a
minor line, validate `status`, tolerate additive fields, and review the
changelog before upgrading.
