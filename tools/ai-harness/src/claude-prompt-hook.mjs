#!/usr/bin/env node
import { defaultRoot, recordPrompt } from "./core.mjs";

let body = "";
for await (const chunk of process.stdin) body += chunk;

try {
  recordPrompt(defaultRoot(), JSON.parse(body || "{}"));
} catch {
  // Prompt logging must not prevent a user from submitting a prompt.
}
