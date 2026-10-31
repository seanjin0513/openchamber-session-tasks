# Panel Install Implementation Plan

> **For the executing agent:** work this plan task-by-task, reporting the result of each task's verification command before moving to the next.

**Goal:** Install the OpenCode reporter from the OpenChamber task panel after explicit confirmation, without terminal commands.

**Architecture:** Share a fixed-path installer between the CLI and authenticated local service. Read status without writing; permit installation only through a confirmed POST. Preserve unknown files and refuse symlinks. The panel shows the destination before a separate confirmation click.

**Tech Stack:** TypeScript, Node filesystem/HTTP APIs, OpenChamber SDK, node:test, ego-browser.

---

### Task 1: Shared Installer And Service

Files: `src/installer.ts`, `src/service.ts`, `scripts/companion.mjs`, `build.mjs`, `test/integration.test.mjs`.

1. Extend integration tests for status, confirmation, idempotent install, conflict preservation, and authenticated POST.
2. Run `npm test`; new endpoint assertions must fail before implementation.
3. Implement only fixed-target status/install operations, staging files before replacing an owned installation; share with CLI.
4. Run `npm test` and `npm run typecheck`; all checks must pass.

### Task 2: Panel Confirmation

Files: `src/panel.ts`, `panel/index.html`, `panel/style.css`, `test/panel.test.mjs`, `dev/bridge.js`.

1. Add panel tests proving startup does not install and confirmation is required before POST.
2. Show status and destination, with cancel/confirm controls and actionable service failure messages.
3. Run `npm test`; verify missing, installed, conflict, and retry states.
4. Run the preview in ego-browser; inspect desktop/mobile confirmation and successful installation, then stop the temporary preview.

### Task 3: Deliver

Files: `README.md`, built `panel/main.js`, `service/main.cjs`, `scripts/installer.js`.

1. Document GUI installation and the same-host limitation; retain CLI fallback.
2. Run `git diff --check`, `npm test`, and `npm run typecheck`.
3. Commit in the feature worktree, fast-forward source main, push, and fast-forward the clean installed extension. Do not auto-install anything on extension startup.
