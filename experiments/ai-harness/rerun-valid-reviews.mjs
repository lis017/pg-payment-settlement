#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const root = process.cwd();
const experimentRoot = path.join(root, "experiments", "ai-harness");
const resultRoot = path.join(root, "results", "real-ab", "2026-09-09");
const meta = JSON.parse(fs.readFileSync(path.join(resultRoot, "experiment-meta.json"), "utf8"));
const summaryPath = path.join(resultRoot, "summary.json");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const tasks = JSON.parse(fs.readFileSync(path.join(experimentRoot, "tasks.json"), "utf8"));
const reviewSchema = path.join(experimentRoot, "schemas", "review-output.schema.json");
const codexExe = execFileSync("where.exe", ["codex"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean).trim();
const model = summary.model;
const reasoningEffort = summary.reasoningEffort;
const reviewerModel = "gpt-6-astra";
const reviewerReasoningEffort = "medium";
const toolTypes = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "computer"]);

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).flatMap((line) => {
    try { return line.trim().startsWith("{") ? [JSON.parse(line)] : []; } catch { return []; }
  });
}

function finalMessage(events) {
  return events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message").at(-1)?.item?.text ?? "";
}

function runProcess(command, args, { cwd, shell = false, timeoutMs = 360_000, env = {} }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd, shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

async function runCodex({ workspace, prompt, phase, traceId, resultDir, writable = false }) {
  const args = [
    "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "--json", "--color", "never", "-m", writable ? model : reviewerModel,
    "-c", `model_reasoning_effort=\"${writable ? reasoningEffort : reviewerReasoningEffort}\"`
  ];
  if (writable) args.push("--approve-for-me");
  else args.push("-s", "read-only", "--output-schema", reviewSchema);
  args.push("-C", workspace, prompt);
  const run = await runProcess(codexExe, args, { cwd: workspace });
  const events = parseEvents(run.stdout);
  fs.appendFileSync(path.join(resultDir, "events.jsonl"), events.map((event) => JSON.stringify({
    traceId, phase, recordedAt: new Date().toISOString(), event
  })).join("\n") + "\n");
  fs.appendFileSync(path.join(resultDir, "prompts.jsonl"), `${JSON.stringify({ traceId, phase, prompt })}\n`);
  fs.writeFileSync(path.join(resultDir, `${phase}-stdout.log`), run.stdout);
  fs.writeFileSync(path.join(resultDir, `${phase}-stderr.log`), run.stderr);
  fs.writeFileSync(path.join(resultDir, `${phase}-result.txt`), finalMessage(events));
  const tools = events.filter((event) => event.type === "item.completed" && toolTypes.has(event.item?.type));
  return { ...run, events, finalMessage: finalMessage(events), toolCalls: tools.length, tracedToolCalls: tools.length };
}

async function evaluate(workspace, task, resultDir, suffix) {
  const run = await runProcess(path.join(workspace, "gradlew.bat"), ["--no-daemon", "test", "--tests", task.testClass], {
    cwd: workspace, shell: true, timeoutMs: 240_000,
    env: { GRADLE_USER_HOME: path.join(os.homedir(), ".gradle") }
  });
  fs.writeFileSync(path.join(resultDir, `hidden-test-output-${suffix}.log`), `${run.stdout}\n${run.stderr}`);
  const xmlPath = path.join(workspace, "build", "test-results", "test", `TEST-${task.testClass}.xml`);
  if (!fs.existsSync(xmlPath)) {
    return { exitCode: run.exitCode, durationMs: run.durationMs, tests: task.expectedTests, passed: 0, failures: 0, errors: 0, skipped: 0, residualDefects: task.expectedTests, compiledAndRan: false };
  }
  const xml = fs.readFileSync(xmlPath, "utf8");
  const suite = xml.match(/<testsuite\b[^>]*>/)?.[0] ?? "";
  const attr = (name) => Number(suite.match(new RegExp(`${name}=\"(\\d+)\"`))?.[1] ?? 0);
  const tests = attr("tests");
  const failures = attr("failures");
  const errors = attr("errors");
  const skipped = attr("skipped");
  fs.copyFileSync(xmlPath, path.join(resultDir, `hidden-test-results-${suffix}.xml`));
  return { exitCode: run.exitCode, durationMs: run.durationMs, tests, passed: tests - failures - errors - skipped, failures, errors, skipped, residualDefects: failures + errors, compiledAndRan: true };
}

function aggregateRows(rows) {
  const direct = rows.map((row) => row.direct);
  const harness = rows.map((row) => row.harness);
  const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const result = {
    taskCount: rows.length,
    sameModelAndEffort: true,
    startManifestPairsIdentical: rows.every((row) => Boolean(row.startManifestHash)),
    direct: {
      outOfScopeChanges: sum(direct, (row) => row.outOfScopeChangeCount),
      finalResidualDefects: sum(direct, (row) => row.evaluation.residualDefects),
      reworkCount: sum(direct, (row) => row.reworkCount),
      totalAgentDurationMs: sum(direct, (row) => row.totalAgentDurationMs),
      medianAgentDurationMs: median(direct.map((row) => row.totalAgentDurationMs)),
      dangerousCommandAttempts: sum(direct, (row) => row.dangerousCommandAttempts),
      toolCalls: sum(direct, (row) => row.toolCalls),
      tracedToolCalls: sum(direct, (row) => row.tracedToolCalls)
    },
    harness: {
      outOfScopeChanges: sum(harness, (row) => row.outOfScopeChangeCount),
      reviewerFindings: sum(harness, (row) => row.reviewerFindingCount),
      finalResidualDefects: sum(harness, (row) => row.evaluation.residualDefects),
      reworkCount: sum(harness, (row) => row.reworkCount),
      totalAgentDurationMs: sum(harness, (row) => row.totalAgentDurationMs),
      medianAgentDurationMs: median(harness.map((row) => row.totalAgentDurationMs)),
      dangerousCommandAttempts: sum(harness, (row) => row.dangerousCommandAttempts),
      dangerousCommandsBlocked: sum(harness, (row) => row.dangerousCommandsBlocked),
      safetyProbeCount: sum(harness, (row) => row.safetyProbeCount),
      toolCalls: sum(harness, (row) => row.toolCalls),
      tracedToolCalls: sum(harness, (row) => row.tracedToolCalls)
    }
  };
  result.direct.traceCoveragePercent = result.direct.toolCalls === 0 ? 100 : Number((result.direct.tracedToolCalls / result.direct.toolCalls * 100).toFixed(1));
  result.harness.traceCoveragePercent = result.harness.toolCalls === 0 ? 100 : Number((result.harness.tracedToolCalls / result.harness.toolCalls * 100).toFixed(1));
  result.residualDefectReduction = result.direct.finalResidualDefects - result.harness.finalResidualDefects;
  result.residualDefectReductionPercent = result.direct.finalResidualDefects === 0 ? null : Number((result.residualDefectReduction / result.direct.finalResidualDefects * 100).toFixed(1));
  return result;
}

const taskFilter = new Set((process.env.TASK_FILTER ?? "").split(",").map((item) => item.trim()).filter(Boolean));
for (const task of tasks.filter((item) => taskFilter.size === 0 || taskFilter.has(item.id))) {
  const row = summary.rows.find((item) => item.taskId === task.id);
  const metrics = row.harness;
  const workspace = path.join(meta.workRoot, task.id, "harness");
  const resultDir = path.join(resultRoot, "runs", task.id, "harness");
  const sourcePath = path.join(workspace, ...task.targetPath.split("/"));
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "<TARGET FILE MISSING>";
  const approvedPlan = JSON.parse(fs.readFileSync(path.join(resultDir, "approved-plan.json"), "utf8"));
  const prompt = [
    "You are the independent read-only Reviewer in a role-separated coding harness.",
    "The source is embedded below because tool access is intentionally unavailable. Compare every explicit requirement to the exact source.",
    "Report only concrete functional, security, overflow, boundary, or contract violations. Return an empty findings array if correct.",
    `TASK:\n${task.requirements}`,
    `APPROVED PLAN:\n${JSON.stringify(approvedPlan.plan)}`,
    `IMPLEMENTED SOURCE (${task.targetPath}):\n${source}`
  ].join("\n\n");
  process.stdout.write(`${task.id} valid reviewer started\n`);
  const reviewer = await runCodex({ workspace, prompt, phase: "reviewer-valid", traceId: metrics.traceId, resultDir });
  let review;
  try { review = JSON.parse(reviewer.finalMessage); } catch { review = { summary: "Reviewer output parse failed", findings: [] }; }
  fs.writeFileSync(path.join(resultDir, "review-valid.json"), JSON.stringify(review, null, 2));
  metrics.totalAgentDurationMs += reviewer.durationMs;
  metrics.toolCalls += reviewer.toolCalls;
  metrics.tracedToolCalls += reviewer.tracedToolCalls;
  metrics.reviewerFindings = Array.isArray(review.findings) ? review.findings : [];
  metrics.reviewerFindingCount = metrics.reviewerFindings.length;

  if (metrics.reviewerFindingCount > 0) {
    const repairPrompt = [
      "You are the Implementer performing one bounded repair pass after independent review.",
      `Modify only ${task.targetPath}. Fix every validated finding and preserve all other required behavior.`,
      `TASK:\n${task.requirements}`,
      `FINDINGS:\n${JSON.stringify(metrics.reviewerFindings)}`
    ].join("\n\n");
    process.stdout.write(`${task.id} repair started (${metrics.reviewerFindingCount} findings)\n`);
    const repair = await runCodex({ workspace, prompt: repairPrompt, phase: "repair-valid", traceId: metrics.traceId, resultDir, writable: true });
    metrics.totalAgentDurationMs += repair.durationMs;
    metrics.toolCalls += repair.toolCalls;
    metrics.tracedToolCalls += repair.tracedToolCalls;
    metrics.reworkCount += 1;
    metrics.evaluation = await evaluate(workspace, task, resultDir, "after-review-repair");
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(resultDir, "final-target.java"));
  }
  metrics.traceCoveragePercent = metrics.toolCalls === 0 ? 100 : Number((metrics.tracedToolCalls / metrics.toolCalls * 100).toFixed(1));
  fs.writeFileSync(path.join(resultDir, "metrics.json"), JSON.stringify(metrics, null, 2));
  process.stdout.write(`${task.id} reviewer findings=${metrics.reviewerFindingCount}, final residual=${metrics.evaluation.residualDefects}\n`);
}

summary.aggregate = aggregateRows(summary.rows);
summary.reviewRerunAt = new Date().toISOString();
summary.reviewMethod = "Source embedded in read-only reviewer prompt; held-out tests remained unseen during initial implementation";
summary.reviewerModel = reviewerModel;
summary.reviewerReasoningEffort = reviewerReasoningEffort;
summary.aggregate.sameImplementerModelAndEffort = true;
summary.aggregate.independentReviewerModel = `${reviewerModel}/${reviewerReasoningEffort}`;
delete summary.aggregate.sameModelAndEffort;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary.aggregate)}\n`);
