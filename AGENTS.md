# AI development workflow

This project uses a mandatory plan-first, human-approved workflow for every AI-authored source change.

## Conversation approval gate

When a user asks to build, fix, refactor, delete, or otherwise change project files, the request starts research only. It does not authorize implementation by itself.

Before approval, the AI must:

1. Inspect the existing structure, relevant source, tests, and configuration using read-only tools.
2. Identify concrete file evidence instead of guessing.
3. Report a reviewable plan containing:
   - current structure and evidence;
   - exact files expected to change;
   - intended change for each file;
   - DB and API impact;
   - tests and verification commands;
   - risks, non-goals, and rollback.
4. End the response with `상태: WAITING_APPROVAL` and stop the turn.

Until the user replies to that plan with an explicit approval such as `OK`, `승인`, or `진행해`, the AI must not use Write, Edit, apply-patch, code-generation, formatting, dependency-installation, or other mutating tools. A client or operating-system permission dialog is not human approval of the development plan. Ambiguous replies and the original implementation request are not approval.

After explicit approval, the AI may record that human decision with `approve --by <name> --source user-chat` and implement only the reported scope. Executing the recording command is not the approval decision; the preceding user message is. The AI must never invent approval, approve its own plan, or treat silence as approval. If scope changes materially, return to `WAITING_APPROVAL` with a revised plan.

Control-plane files under `.ai-harness/runtime/**` and Plan artifacts under `.ai-harness/plans/**` may be created before approval. They must not contain source-code changes or credentials.

## Enforced workflow

1. Initialize the trace with `node tools/ai-harness/src/cli.mjs init`.
2. Researcher performs read-only inspection and records file evidence.
3. Planner writes only a Plan artifact matching `.ai-harness/schemas/plan.schema.json`.
4. Submit it with `node tools/ai-harness/src/cli.mjs submit <plan.json>`. The state becomes `WAITING_APPROVAL`.
5. Report the plan to the user and stop. Claude Code's hook blocks source writes and non-read-only commands in this state.
6. After the user's explicit approval, record it with `node tools/ai-harness/src/cli.mjs approve --by <name> --source user-chat`.
7. Implementer changes only approved paths and runs only approved commands.
8. Reviewer independently reports findings and never edits files.
9. Use `review`, then `complete`, and finish with `audit`.

Never bypass `.claude/settings.json`, modify harness policy during an active trace, expose credentials in prompts or logs, or execute destructive Git, filesystem, database, or Docker commands.

Codex must follow this file as its project-level behavior contract. Claude Code additionally enforces the write boundary through the configured `PreToolUse` hook.
