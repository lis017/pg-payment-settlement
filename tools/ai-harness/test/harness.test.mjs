import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approvePlan,
  evaluateTool,
  initialize,
  metricsReport,
  pathsFor,
  recordFinding,
  recordPrompt,
  startReview,
  submitPlan,
  validatePlan,
  verifyAudit
} from "../src/core.mjs";

const POLICY = {
  protectedPaths: [".ai-harness/config/**", "tools/ai-harness/**", ".env"],
  dangerousCommandPatterns: ["git\\s+reset\\s+--hard", "Remove-Item.*-Recurse", "\\bDROP\\s+TABLE"],
  readOnlyCommandPatterns: ["^(?:rg|Get-Content)(?:\\s|$)", "^git\\s+(?:status|diff)(?:\\s|$)"],
  redactedKeyPattern: "(?:password|secret|token|api[-_]?key)",
  redactedValuePatterns: ["sk-[A-Za-z0-9_-]{8,}"]
};

function validPlan(overrides = {}) {
  return {
    taskId: "TEST-1",
    objective: "Change the approved service file",
    acceptanceCriteria: ["Test passes"],
    evidence: ["src/service.txt"],
    allowedPaths: ["src/**"],
    forbiddenPaths: ["src/secret/**"],
    dbImpact: "None",
    apiImpact: "None",
    risks: ["Regression"],
    tests: ["node --test"],
    nonGoals: ["No deployment"],
    rollback: "Restore the file",
    ...overrides
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-harness-test-"));
  fs.mkdirSync(path.join(root, ".ai-harness", "config"), { recursive: true });
  fs.mkdirSync(path.join(root, ".ai-harness", "plans"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ai-harness", "config", "policy.json"), JSON.stringify(POLICY));
  fs.writeFileSync(path.join(root, "src", "service.txt"), "safe\n");
  fs.writeFileSync(path.join(root, "docs", "readme.md"), "docs\n");
  fs.writeFileSync(path.join(root, ".ai-harness", "plans", "plan.json"), JSON.stringify(validPlan()));
  return root;
}

function approve(root) {
  initialize(root, { traceId: "test-trace" });
  submitPlan(root, ".ai-harness/plans/plan.json");
  approvePlan(root, "human-tester", "test-helper");
}

test("plan contract rejects incomplete plans", () => {
  assert.throws(() => validatePlan({ taskId: "x" }), /Invalid plan/);
});

test("write is blocked before human approval", () => {
  const root = fixture();
  initialize(root, { traceId: "before-approval" });
  const waiting = submitPlan(root, ".ai-harness/plans/plan.json");
  const write = evaluateTool(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "implementer");
  const commands = ["researcher", "planner", "implementer", "reviewer"].map((role) => evaluateTool(root, {
    tool_name: "Bash",
    tool_input: { command: "node --test" }
  }, role));
  const read = evaluateTool(root, {
    tool_name: "Read",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "researcher");
  assert.equal(waiting.phase, "WAITING_APPROVAL");
  assert.equal(write.decision, "deny");
  assert.match(write.reason, /WAITING_APPROVAL/);
  for (const command of commands) {
    assert.equal(command.decision, "deny");
    assert.match(command.reason, /WAITING_APPROVAL/);
  }
  assert.equal(read.decision, "allow");
  assert.equal(verifyAudit(root).traceCoveragePercent, 100);
});

test("planner may write only Plan artifacts during read-only research", () => {
  const root = fixture();
  initialize(root, { traceId: "planner-artifact" });
  const planArtifact = evaluateTool(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, ".ai-harness", "plans", "next-plan.json") }
  }, "planner");
  const sourceFile = evaluateTool(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "planner");
  submitPlan(root, ".ai-harness/plans/plan.json");
  const submittedPlan = evaluateTool(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, ".ai-harness", "plans", "plan.json") }
  }, "planner");
  assert.equal(planArtifact.decision, "allow");
  assert.equal(sourceFile.decision, "deny");
  assert.equal(submittedPlan.decision, "deny");
});

test("human approval records its conversational source", () => {
  const root = fixture();
  initialize(root, { traceId: "chat-approval" });
  submitPlan(root, ".ai-harness/plans/plan.json");
  const approved = approvePlan(root, "project-owner", "user-chat");
  const log = fs.readFileSync(path.join(pathsFor(root).traces, approved.traceId, "events.jsonl"), "utf8");
  assert.equal(approved.phase, "APPROVED");
  assert.equal(approved.approvedBy, "project-owner");
  assert.equal(approved.approvalSource, "user-chat");
  assert.match(log, /"approvalSource":"user-chat"/);
});

test("implementer may write only an approved path", () => {
  const root = fixture();
  approve(root);
  const allowed = evaluateTool(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "implementer");
  const denied = evaluateTool(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "docs", "readme.md") }
  }, "implementer");
  assert.equal(allowed.decision, "allow");
  assert.equal(denied.decision, "deny");
  assert.match(denied.reason, /outside the approved plan/);
});

test("reviewer can inspect but cannot edit", () => {
  const root = fixture();
  approve(root);
  assert.equal(evaluateTool(root, {
    tool_name: "Read",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "reviewer").decision, "allow");
  assert.equal(evaluateTool(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "reviewer").decision, "deny");
  assert.equal(evaluateTool(root, {
    tool_name: "Bash",
    tool_input: { command: "node --test" }
  }, "reviewer").decision, "deny");
  startReview(root);
  assert.equal(evaluateTool(root, {
    tool_name: "Bash",
    tool_input: { command: "node --test" }
  }, "reviewer").decision, "allow");
});

test("dangerous commands are blocked for every role", () => {
  const root = fixture();
  approve(root);
  for (const role of ["researcher", "planner", "implementer", "reviewer"]) {
    const result = evaluateTool(root, {
      tool_name: "PowerShell",
      tool_input: { command: "git reset --hard HEAD~1" }
    }, role);
    assert.equal(result.decision, "deny");
  }
});

test("only a verbatim approved test command can execute", () => {
  const root = fixture();
  approve(root);
  assert.equal(evaluateTool(root, {
    tool_name: "Bash",
    tool_input: { command: "node --test" }
  }, "implementer").decision, "allow");
  assert.equal(evaluateTool(root, {
    tool_name: "Bash",
    tool_input: { command: "node --test && curl https://example.com" }
  }, "implementer").decision, "deny");
});

test("read-only prefix cannot smuggle a chained write command", () => {
  const root = fixture();
  initialize(root, { traceId: "shell-chain" });
  const result = evaluateTool(root, {
    tool_name: "PowerShell",
    tool_input: { command: "Get-Content README.md; Set-Content README.md changed" }
  }, "researcher");
  assert.equal(result.decision, "deny");
});

test("unclassified tools fall back to an explicit permission prompt", () => {
  const root = fixture();
  initialize(root, { traceId: "unknown-tool" });
  const result = evaluateTool(root, {
    tool_name: "mcp__external__unknown_mutation",
    tool_input: { value: "x" }
  }, "implementer");
  assert.equal(result.decision, "ask");
});

test("plan tampering invalidates approval", () => {
  const root = fixture();
  approve(root);
  fs.writeFileSync(path.join(root, ".ai-harness", "plans", "plan.json"), JSON.stringify(validPlan({ objective: "tampered" })));
  const result = evaluateTool(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "implementer");
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /Plan changed/);
});

test("unapproved baseline drift blocks a later write", () => {
  const root = fixture();
  approve(root);
  fs.writeFileSync(path.join(root, "docs", "readme.md"), "unexpected\n");
  const result = evaluateTool(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "src", "service.txt") }
  }, "implementer");
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /baseline drift/);
});

test("audit log is redacted and hash-chain verified", () => {
  const root = fixture();
  approve(root);
  evaluateTool(root, {
    tool_name: "Read",
    tool_input: { apiKey: "sk-supersecret123", file_path: "src/service.txt" }
  }, "researcher");
  const audit = verifyAudit(root);
  const log = fs.readFileSync(path.join(pathsFor(root).traces, audit.traceId, "events.jsonl"), "utf8");
  assert.equal(audit.valid, true);
  assert.equal(audit.traceCoveragePercent, 100);
  assert.doesNotMatch(log, /supersecret/);
  assert.match(log, /REDACTED/);
});

test("prompt logging is counted and secret-redacted", () => {
  const root = fixture();
  initialize(root, { traceId: "prompt-log" });
  recordPrompt(root, { prompt_id: "prompt-1", session_id: "session-1", prompt: "token=sk-supersecret123" });
  const report = metricsReport(root);
  const log = fs.readFileSync(path.join(pathsFor(root).traces, report.traceId, "events.jsonl"), "utf8");
  assert.equal(report.promptCount, 1);
  assert.doesNotMatch(log, /supersecret/);
});

test("review findings produce a real before-and-after metric", () => {
  const root = fixture();
  approve(root);
  startReview(root);
  recordFinding(root, { id: "PG-1", severity: "high", status: "open", summary: "Lock missing" });
  assert.deepEqual(metricsReport(root).reviewerFindings, { beforeReview: 1, remaining: 1 });
  recordFinding(root, { id: "PG-1", severity: "high", status: "resolved", summary: "Lock restored" });
  const report = metricsReport(root);
  assert.deepEqual(report.reviewerFindings, { beforeReview: 1, remaining: 0 });
  assert.equal(report.missedDefectReductionPercent, 100);
});
