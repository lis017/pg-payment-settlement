#!/usr/bin/env node
import path from "node:path";
import {
  approvePlan,
  complete,
  currentStatus,
  defaultRoot,
  evaluateTool,
  initialize,
  metricsReport,
  recordFinding,
  startReview,
  submitPlan,
  verifyAudit
} from "./core.mjs";

const [command, ...args] = process.argv.slice(2);
const root = process.env.AI_HARNESS_ROOT ? path.resolve(process.env.AI_HARNESS_ROOT) : defaultRoot();

function valueOf(flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  switch (command) {
    case "init":
      print(initialize(root));
      break;
    case "submit":
      if (!args[0]) throw new Error("Usage: submit <plan.json>");
      print(submitPlan(root, args[0]));
      break;
    case "approve":
      print(approvePlan(root, valueOf("--by"), valueOf("--source") ?? "local-cli"));
      break;
    case "review":
      print(startReview(root));
      break;
    case "complete":
      print(complete(root));
      break;
    case "status":
      print(currentStatus(root));
      break;
    case "audit":
      print(verifyAudit(root));
      break;
    case "finding":
      print(recordFinding(root, {
        id: valueOf("--id"),
        severity: valueOf("--severity"),
        status: valueOf("--status", "open"),
        summary: valueOf("--summary", "")
      }));
      break;
    case "report":
      print(metricsReport(root));
      break;
    case "gate": {
      const input = JSON.parse(valueOf("--input", "{}"));
      print(evaluateTool(root, input, valueOf("--role")));
      break;
    }
    default:
      throw new Error("Commands: init | submit <plan.json> | approve --by <name> [--source <source>] | status | gate --role <role> --input <json> | review | finding --id <id> --severity <level> [--status open|resolved] | complete | audit | report");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
