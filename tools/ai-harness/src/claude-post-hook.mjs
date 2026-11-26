#!/usr/bin/env node
import { defaultRoot, recordToolResult } from "./core.mjs";

let body = "";
for await (const chunk of process.stdin) body += chunk;

try {
  const input = JSON.parse(body || "{}");
  recordToolResult(defaultRoot(), input, input.hook_event_name !== "PostToolUseFailure");
} catch {
  // Post hooks must not hide the original tool result when audit logging fails.
}
