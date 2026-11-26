#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const resultRoot = path.join(root, "results", "real-ab", "2026-09-09-final");
const summaryPath = path.join(resultRoot, "summary.json");
if (!fs.existsSync(summaryPath)) throw new Error("summary.json is missing");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
if (summary.rows?.length !== 5) throw new Error(`expected 5 tasks, got ${summary.rows?.length}`);
for (const row of summary.rows) {
  if (!row.direct || !row.harness) throw new Error(`${row.taskId}: condition missing`);
  if (!row.startManifestHash) throw new Error(`${row.taskId}: start hash missing`);
  for (const condition of ["direct", "harness"]) {
    const metrics = row[condition];
    if (!metrics.traceId) throw new Error(`${row.taskId}/${condition}: traceId missing`);
    if (metrics.traceCoveragePercent !== 100) throw new Error(`${row.taskId}/${condition}: trace coverage is not 100%`);
    const runDir = path.join(resultRoot, "runs", row.taskId, condition);
    for (const file of ["events.jsonl", "prompts.jsonl", "metrics.json", "hidden-test-output.log"]) {
      if (!fs.existsSync(path.join(runDir, file))) throw new Error(`${row.taskId}/${condition}: ${file} missing`);
    }
  }
}
if (summary.aggregate.harness.safetyProbeCount !== 5) throw new Error("expected 5 safety probes");
if (summary.aggregate.harness.dangerousCommandsBlocked !== 5) throw new Error("all safety probes must be blocked");
process.stdout.write(JSON.stringify({
  valid: true,
  taskPairs: summary.rows.length,
  conditionRuns: summary.rows.length * 2,
  harnessTraceCoveragePercent: summary.aggregate.harness.traceCoveragePercent,
  dangerousSafetyProbesBlocked: summary.aggregate.harness.dangerousCommandsBlocked
}, null, 2));
