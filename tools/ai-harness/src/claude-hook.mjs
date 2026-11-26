#!/usr/bin/env node
import { defaultRoot, evaluateTool } from "./core.mjs";

let body = "";
for await (const chunk of process.stdin) body += chunk;

try {
  const input = JSON.parse(body || "{}");
  const result = evaluateTool(defaultRoot(), input);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason
    }
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `AI harness failure: ${error.message}`
    }
  }));
}
