import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_VERSION = 1;
const ZERO_HASH = "0".repeat(64);
const WAITING_APPROVAL_PHASE = "WAITING_APPROVAL";
const LEGACY_WAITING_APPROVAL_PHASE = "PLAN_PENDING";
const ROLES = new Set(["researcher", "planner", "implementer", "reviewer"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);

export function defaultRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), "../../..");
}

export function pathsFor(root = defaultRoot()) {
  const runtime = path.join(root, ".ai-harness", "runtime");
  return {
    root,
    runtime,
    state: path.join(runtime, "state.json"),
    traces: path.join(runtime, "traces"),
    policy: path.join(root, ".ai-harness", "config", "policy.json")
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRelative(root, candidate) {
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (relative === "" || relative === ".") return ".";
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${candidate}`);
  }
  return relative;
}

function globRegex(glob) {
  let result = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      result += ".*";
      index += 1;
    } else if (character === "*") {
      result += "[^/]*";
    } else if (character === "?") {
      result += "[^/]";
    } else {
      result += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${result}$`);
}

export function matchesAny(relativePath, patterns = []) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  return patterns.some((pattern) => globRegex(pattern.replaceAll("\\", "/")).test(normalized));
}

function shouldIgnore(relativePath) {
  return matchesAny(relativePath, [
    ".git/**", ".gradle/**", "build/**", "out/**", "node_modules/**", ".idea/**",
    ".ai-harness/runtime/**", ".ai-harness/plans/**", "docs/ai-harness/results/**"
  ]);
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = normalizeRelative(root, absolute);
    if (shouldIgnore(`${relative}${entry.isDirectory() ? "/**" : ""}`) || shouldIgnore(relative)) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, files);
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export function createManifest(root = defaultRoot()) {
  const files = walkFiles(root).sort();
  const entries = Object.fromEntries(files.map((relative) => [
    relative,
    sha256(fs.readFileSync(path.join(root, relative)))
  ]));
  return { entries, hash: sha256(canonicalJson(entries)) };
}

export function diffManifests(before, after) {
  const all = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]);
  return [...all].sort().filter((file) => before.entries[file] !== after.entries[file]);
}

function ensureRuntime(root) {
  const paths = pathsFor(root);
  fs.mkdirSync(paths.traces, { recursive: true });
  return paths;
}

export function loadPolicy(root = defaultRoot()) {
  const { policy } = pathsFor(root);
  return JSON.parse(fs.readFileSync(policy, "utf8"));
}

export function loadState(root = defaultRoot(), optional = false) {
  const { state } = pathsFor(root);
  if (!fs.existsSync(state)) {
    if (optional) return null;
    throw new Error("Harness is not initialized. Run: node tools/ai-harness/src/cli.mjs init");
  }
  return JSON.parse(fs.readFileSync(state, "utf8"));
}

function saveState(root, state) {
  const paths = ensureRuntime(root);
  fs.writeFileSync(paths.state, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function withStateLock(root, operation) {
  const { runtime } = ensureRuntime(root);
  const lockPath = path.join(runtime, ".state.lock");
  const started = Date.now();
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 5000) throw new Error("Timed out waiting for the AI harness state lock");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

function mutateState(root, mutation) {
  return withStateLock(root, () => {
    const state = loadState(root);
    mutation(state);
    saveState(root, state);
    return state;
  });
}

function redact(value, policy) {
  if (Array.isArray(value)) return value.map((item) => redact(item, policy));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      policy.redactedKeyPattern && new RegExp(policy.redactedKeyPattern, "i").test(key)
        ? "[REDACTED]"
        : redact(item, policy)
    ]));
  }
  if (typeof value !== "string") return value;
  return (policy.redactedValuePatterns ?? []).reduce(
    (current, pattern) => current.replace(new RegExp(pattern, "gi"), "[REDACTED]"),
    value
  );
}

export function appendEvent(root, type, payload = {}, metricDeltas = {}) {
  return withStateLock(root, () => {
    const state = loadState(root);
    const policy = loadPolicy(root);
    const { spanId, ...eventPayload } = payload;
    const event = {
      version: STATE_VERSION,
      traceId: state.traceId,
      spanId: spanId ?? crypto.randomUUID(),
      sequence: state.sequence + 1,
      timestamp: new Date().toISOString(),
      type,
      payload: redact(eventPayload, policy),
      previousHash: state.lastEventHash ?? ZERO_HASH
    };
    event.eventHash = sha256(canonicalJson(event));
    const traceDirectory = path.join(pathsFor(root).traces, state.traceId);
    fs.mkdirSync(traceDirectory, { recursive: true });
    fs.appendFileSync(path.join(traceDirectory, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
    state.sequence = event.sequence;
    state.lastEventHash = event.eventHash;
    state.metrics.events += 1;
    if (eventPayload.decision === "deny") state.metrics.blocked += 1;
    for (const [metric, delta] of Object.entries(metricDeltas)) {
      state.metrics[metric] = (state.metrics[metric] ?? 0) + delta;
    }
    saveState(root, state);
    return event;
  });
}

export function initialize(root = defaultRoot(), options = {}) {
  ensureRuntime(root);
  loadPolicy(root);
  const manifest = createManifest(root);
  const state = {
    version: STATE_VERSION,
    traceId: options.traceId ?? crypto.randomUUID(),
    phase: "RESEARCHING",
    createdAt: new Date().toISOString(),
    baseline: manifest,
    planPath: null,
    planHash: null,
    plan: null,
    approvedBy: null,
    approvalSource: null,
    approvedAt: null,
    sequence: 0,
    lastEventHash: ZERO_HASH,
    findings: [],
    metrics: { events: 0, blocked: 0, toolCalls: 0, tracedToolCalls: 0, prompts: 0 }
  };
  saveState(root, state);
  appendEvent(root, "HARNESS_INITIALIZED", { baselineHash: manifest.hash, phase: state.phase });
  return loadState(root);
}

export function validatePlan(plan) {
  const requiredStrings = ["taskId", "objective", "dbImpact", "apiImpact", "rollback"];
  const requiredArrays = ["acceptanceCriteria", "evidence", "allowedPaths", "forbiddenPaths", "risks", "tests", "nonGoals"];
  const errors = [];
  for (const field of requiredStrings) {
    if (typeof plan[field] !== "string" || plan[field].trim() === "") errors.push(`${field} must be a non-empty string`);
  }
  for (const field of requiredArrays) {
    if (!Array.isArray(plan[field]) || plan[field].length === 0) errors.push(`${field} must be a non-empty array`);
  }
  for (const candidate of plan.allowedPaths ?? []) {
    if (candidate === "**" || candidate === "*" || candidate === ".") errors.push("allowedPaths cannot grant the entire project");
    if (candidate.includes("..")) errors.push(`allowedPaths cannot escape the project: ${candidate}`);
  }
  if (errors.length > 0) throw new Error(`Invalid plan:\n- ${errors.join("\n- ")}`);
  return true;
}

export function submitPlan(root = defaultRoot(), planPath) {
  const state = loadState(root);
  if (!["RESEARCHING", WAITING_APPROVAL_PHASE, LEGACY_WAITING_APPROVAL_PHASE].includes(state.phase)) {
    throw new Error(`Cannot submit a plan while phase is ${state.phase}`);
  }
  const relative = normalizeRelative(root, planPath);
  const plan = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  validatePlan(plan);
  state.phase = WAITING_APPROVAL_PHASE;
  state.planPath = relative;
  state.planHash = sha256(canonicalJson(plan));
  state.plan = plan;
  saveState(root, state);
  appendEvent(root, "PLAN_SUBMITTED", { planPath: relative, planHash: state.planHash, phase: state.phase });
  return loadState(root);
}

function validatePlanIntegrity(root, state) {
  if (!state.planPath || !state.planHash) throw new Error("No submitted plan");
  const plan = JSON.parse(fs.readFileSync(path.join(root, state.planPath), "utf8"));
  const currentHash = sha256(canonicalJson(plan));
  if (currentHash !== state.planHash) throw new Error("Plan changed after submission; submit it again");
  return plan;
}

function outOfScopeChanges(root, state) {
  const current = createManifest(root);
  const changed = diffManifests(state.baseline, current);
  const allowed = state.plan?.allowedPaths ?? [];
  return changed.filter((file) => !matchesAny(file, allowed));
}

export function approvePlan(root = defaultRoot(), approvedBy, approvalSource = "local-cli") {
  const state = loadState(root);
  if (![WAITING_APPROVAL_PHASE, LEGACY_WAITING_APPROVAL_PHASE].includes(state.phase)) {
    throw new Error(`Expected ${WAITING_APPROVAL_PHASE}, got ${state.phase}`);
  }
  if (!approvedBy?.trim()) throw new Error("--by is required for human approval attribution");
  if (!approvalSource?.trim()) throw new Error("--source is required for approval provenance");
  state.plan = validatePlanIntegrity(root, state);
  const drift = diffManifests(state.baseline, createManifest(root));
  if (drift.length > 0) throw new Error(`Baseline changed before approval: ${drift.join(", ")}`);
  state.phase = "APPROVED";
  state.approvedBy = approvedBy.trim();
  state.approvalSource = approvalSource.trim();
  state.approvedAt = new Date().toISOString();
  saveState(root, state);
  appendEvent(root, "PLAN_APPROVED", {
    approvedBy: state.approvedBy,
    approvalSource: state.approvalSource,
    approvedAt: state.approvedAt,
    planHash: state.planHash,
    phase: state.phase
  });
  return loadState(root);
}

export function startReview(root = defaultRoot()) {
  const state = loadState(root);
  if (!["APPROVED", "IMPLEMENTING"].includes(state.phase)) throw new Error(`Cannot review from ${state.phase}`);
  state.phase = "REVIEWING";
  saveState(root, state);
  appendEvent(root, "REVIEW_STARTED", { phase: state.phase });
  return loadState(root);
}

export function complete(root = defaultRoot()) {
  const state = loadState(root);
  if (state.phase !== "REVIEWING") throw new Error(`Expected REVIEWING, got ${state.phase}`);
  const openFindings = state.findings.filter((finding) => finding.status !== "resolved");
  if (openFindings.length > 0) throw new Error(`Resolve or explicitly remove open findings first: ${openFindings.map((finding) => finding.id).join(", ")}`);
  state.phase = "COMPLETED";
  state.findingCount = state.findings.length;
  saveState(root, state);
  appendEvent(root, "WORKFLOW_COMPLETED", { phase: state.phase, findingCount: state.findingCount });
  return loadState(root);
}

function roleFrom(input, explicitRole) {
  const inferred = input.agent_type?.toLowerCase();
  const role = explicitRole ?? (ROLES.has(inferred) ? inferred : process.env.AI_HARNESS_ROLE) ?? "researcher";
  return ROLES.has(role) ? role : "researcher";
}

function extractPath(toolInput) {
  return toolInput.file_path ?? toolInput.path ?? toolInput.notebook_path ?? null;
}

function isDangerous(command, policy) {
  return (policy.dangerousCommandPatterns ?? []).some((pattern) => new RegExp(pattern, "i").test(command));
}

function isReadOnlyCommand(command, policy) {
  // A prefix allowlist is unsafe when a second command can be appended.
  if (/[;&|><\r\n`]/.test(command) || command.includes("$(")) return false;
  return (policy.readOnlyCommandPatterns ?? []).some((pattern) => new RegExp(pattern, "i").test(command.trim()));
}

function isApprovedTestCommand(command, plan) {
  return (plan?.tests ?? []).some((approved) => command.trim() === approved.trim());
}

function summarizeToolInput(toolInput) {
  const contentKeys = new Set(["content", "new_string", "old_string", "code", "patch"]);
  return Object.fromEntries(Object.entries(toolInput).map(([key, value]) => {
    if (contentKeys.has(key) && typeof value === "string") {
      return [key, { length: value.length, sha256: sha256(value) }];
    }
    if (typeof value === "string" && value.length > 2000) {
      return [key, `${value.slice(0, 2000)}…[truncated:${value.length}]`];
    }
    return [key, value];
  }));
}

export function evaluateTool(root = defaultRoot(), hookInput, explicitRole) {
  const policy = loadPolicy(root);
  let state = loadState(root, true);
  const role = roleFrom(hookInput, explicitRole);
  const toolName = hookInput.tool_name ?? hookInput.toolName ?? "Unknown";
  const toolInput = hookInput.tool_input ?? hookInput.toolInput ?? {};
  let decision = READ_TOOLS.has(toolName) ? "allow" : "ask";
  let reason = READ_TOOLS.has(toolName)
    ? "Known read-only tool"
    : "Unclassified tool requires normal client permission";

  if (WRITE_TOOLS.has(toolName)) {
    const candidate = extractPath(toolInput);
    if (!state) {
      decision = "deny";
      reason = "Harness is not initialized";
    } else if (!candidate) {
      decision = "deny";
      reason = "Write tool did not provide a file path";
    } else {
      try {
        const relative = normalizeRelative(root, candidate);
        if (role === "planner" && state.phase === "RESEARCHING") {
          if (matchesAny(relative, [".ai-harness/plans/**"])) {
            decision = "allow";
            reason = `Planner may write only a Plan artifact before approval: ${relative}`;
          } else {
            decision = "deny";
            reason = `Planner may write only .ai-harness/plans/** before approval: ${relative}`;
          }
        } else if (role !== "implementer") {
          decision = "deny";
          reason = `${role} is read-only`;
        } else if (!["APPROVED", "IMPLEMENTING"].includes(state.phase)) {
          decision = "deny";
          reason = `Writes require APPROVED phase; current phase is ${state.phase}`;
        } else {
          validatePlanIntegrity(root, state);
          if (matchesAny(relative, policy.protectedPaths ?? []) || matchesAny(relative, state.plan.forbiddenPaths ?? [])) {
            decision = "deny";
            reason = `Protected or explicitly forbidden path: ${relative}`;
          } else if (!matchesAny(relative, state.plan.allowedPaths)) {
            decision = "deny";
            reason = `Path is outside the approved plan: ${relative}`;
          } else {
            const drift = outOfScopeChanges(root, state);
            if (drift.length > 0) {
              decision = "deny";
              reason = `Unapproved baseline drift detected: ${drift.join(", ")}`;
            } else {
              decision = "allow";
              reason = `Approved implementer path: ${relative}`;
            }
          }
        }
      } catch (error) {
        decision = "deny";
        reason = error.message;
      }
    }
  } else if (SHELL_TOOLS.has(toolName)) {
    const command = String(toolInput.command ?? "");
    if (isDangerous(command, policy)) {
      decision = "deny";
      reason = "Command matches the dangerous-command policy";
    } else if (isReadOnlyCommand(command, policy)) {
      decision = "allow";
      reason = "Read-only command allowed";
    } else if (!state) {
      decision = "deny";
      reason = "Non-read-only commands require an initialized harness";
    } else if (!["APPROVED", "IMPLEMENTING", "REVIEWING"].includes(state.phase)) {
      decision = "deny";
      reason = `Command requires human-approved phase; current phase is ${state.phase}`;
    } else if (role === "reviewer") {
      if (state.phase === "REVIEWING" && isApprovedTestCommand(command, state.plan)) {
        decision = "allow";
        reason = "Reviewer may execute an explicitly approved test command during review";
      } else {
        decision = "deny";
        reason = "Reviewer may run approved test commands only during REVIEWING";
      }
    } else if (role !== "implementer") {
      decision = "deny";
      reason = `${role} may only run read-only commands`;
    } else if (!isApprovedTestCommand(command, state.plan)) {
      decision = "deny";
      reason = "Command is not listed verbatim in plan.tests";
    } else {
      decision = "allow";
      reason = "Approved test command";
    }
  }

  if (state) {
    appendEvent(root, "TOOL_DECISION", {
      spanId: hookInput.tool_use_id ?? hookInput.agent_id,
      role, toolName, toolInput: summarizeToolInput(toolInput), decision, reason
    }, { toolCalls: 1, tracedToolCalls: 1 });
    if (decision === "allow" && role === "implementer" && state.phase === "APPROVED" && (WRITE_TOOLS.has(toolName) || SHELL_TOOLS.has(toolName))) {
      mutateState(root, (latest) => {
        if (latest.phase === "APPROVED") latest.phase = "IMPLEMENTING";
      });
    }
  }

  return { decision, reason, role, toolName };
}

export function recordToolResult(root = defaultRoot(), hookInput, success) {
  const state = loadState(root, true);
  if (!state) return null;
  const response = hookInput.tool_response ?? hookInput.error ?? null;
  const serialized = canonicalJson(response);
  return appendEvent(root, success ? "TOOL_SUCCEEDED" : "TOOL_FAILED", {
    spanId: hookInput.tool_use_id ?? hookInput.agent_id,
    toolName: hookInput.tool_name ?? "Unknown",
    toolUseId: hookInput.tool_use_id ?? null,
    success,
    resultDigest: sha256(serialized),
    resultSummary: serialized.length > 1000 ? `${serialized.slice(0, 1000)}…[truncated:${serialized.length}]` : serialized
  });
}

export function recordPrompt(root = defaultRoot(), hookInput) {
  const state = loadState(root, true);
  if (!state) return null;
  return appendEvent(root, "PROMPT_SUBMITTED", {
    spanId: hookInput.prompt_id,
    sessionId: hookInput.session_id ?? null,
    prompt: hookInput.prompt ?? ""
  }, { prompts: 1 });
}

export function recordFinding(root = defaultRoot(), finding) {
  const state = loadState(root);
  if (state.phase !== "REVIEWING") throw new Error(`Findings can be recorded only in REVIEWING; got ${state.phase}`);
  const id = String(finding.id ?? "").trim();
  const severity = String(finding.severity ?? "").toLowerCase();
  const status = String(finding.status ?? "open").toLowerCase();
  if (!id) throw new Error("Finding id is required");
  if (!["low", "medium", "high", "critical"].includes(severity)) throw new Error("Severity must be low, medium, high, or critical");
  if (!["open", "resolved"].includes(status)) throw new Error("Status must be open or resolved");
  const existing = state.findings.find((item) => item.id === id);
  if (existing) {
    existing.status = status;
    existing.updatedAt = new Date().toISOString();
  } else {
    state.findings.push({ id, severity, status, summary: finding.summary ?? "", createdAt: new Date().toISOString() });
  }
  saveState(root, state);
  appendEvent(root, status === "resolved" ? "REVIEW_FINDING_RESOLVED" : "REVIEW_FINDING_RECORDED", {
    id, severity, status, summary: finding.summary ?? ""
  });
  return loadState(root).findings;
}

export function verifyAudit(root = defaultRoot()) {
  const state = loadState(root);
  const logPath = path.join(pathsFor(root).traces, state.traceId, "events.jsonl");
  const lines = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
  let previousHash = ZERO_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index]);
    const storedHash = event.eventHash;
    delete event.eventHash;
    if (event.previousHash !== previousHash) throw new Error(`Broken previousHash at event ${index + 1}`);
    const actualHash = sha256(canonicalJson(event));
    if (storedHash !== actualHash) throw new Error(`Tampered event ${index + 1}`);
    previousHash = storedHash;
  }
  const coverage = state.metrics.toolCalls === 0 ? 100 : (state.metrics.tracedToolCalls / state.metrics.toolCalls) * 100;
  return {
    valid: previousHash === state.lastEventHash,
    eventCount: lines.length,
    toolCalls: state.metrics.toolCalls,
    tracedToolCalls: state.metrics.tracedToolCalls,
    traceCoveragePercent: Number(coverage.toFixed(1)),
    traceId: state.traceId
  };
}

export function currentStatus(root = defaultRoot()) {
  const state = loadState(root);
  const changed = diffManifests(state.baseline, createManifest(root));
  return {
    traceId: state.traceId,
    phase: state.phase,
    planPath: state.planPath,
    approvedBy: state.approvedBy,
    approvalSource: state.approvalSource ?? null,
    approvedAt: state.approvedAt,
    changedFiles: changed,
    outOfScopeChanges: state.plan ? changed.filter((file) => !matchesAny(file, state.plan.allowedPaths)) : changed,
    metrics: state.metrics
  };
}

export function metricsReport(root = defaultRoot()) {
  const state = loadState(root);
  const audit = verifyAudit(root);
  const totalFindings = state.findings.length;
  const openFindings = state.findings.filter((finding) => finding.status !== "resolved").length;
  return {
    traceId: state.traceId,
    phase: state.phase,
    reviewerFindings: { beforeReview: totalFindings, remaining: openFindings },
    missedDefectReductionPercent: totalFindings === 0 ? null : Number((((totalFindings - openFindings) / totalFindings) * 100).toFixed(1)),
    blockedToolCalls: state.metrics.blocked,
    promptCount: state.metrics.prompts,
    toolCallTraceCoveragePercent: audit.traceCoveragePercent,
    auditChainValid: audit.valid,
    auditEventCount: audit.eventCount
  };
}
