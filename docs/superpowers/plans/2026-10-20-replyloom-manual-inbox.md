# ReplyLoom Manual Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ReplyLoom into a manual-only WhatsApp inbox: read conversations and send replies only when the user explicitly submits them.

**Architecture:** Keep apps/web for authenticated inbox UI and apps/worker for WhatsApp sessions. Disable inbound-triggered side effects, AI, broadcasts and scheduled automation without deleting stored data or unrelated schema. Keep the existing WhatsApp session/watchdog lifecycle needed to maintain connectivity, and verify all Cloudflare cost assumptions before any deployment.

**Tech Stack:** TypeScript, React, TanStack Start, Cloudflare Workers, Durable Objects, D1, KV, Vitest, Wrangler, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-20-replyloom-manual-inbox-design.md`

## Global Constraints

- No automated replies, AI, campaigns, scheduled messages or follow-up automation.
- Preserve authentication, workspace isolation, session ownership checks and manual send authorization.
- Incoming messages must never trigger outbound sends.
- Do not provision new Cloudflare resources or invoke Workers AI, AI Gateway or Vectorize.
- Do not delete existing databases, namespaces, sessions, tables or stored data.
- Preserve pre-existing uncommitted changes in `apps/web/src/routeTree.gen.ts`, `apps/worker/src/compat/ws-shim.ts`, `apps/worker/src/session/whatsapp-session.ts`, and the two `.pre-login-fix.bak` files.
- Never display, read into logs, or commit secrets.
- No production deploy until the Cloudflare account plan, current resources, quotas, potential costs and rollback are verified. If zero-cost cannot be established, leave changes local.

## Review Focus

- Inbound `notify` and `append` events must not send a reply — test both types.
- Manual send must remain authenticated and workspace-scoped — retain/add negative authorization tests.
- WhatsApp watchdog/reconnect behavior must remain available even when automation cron is removed — test/review session alarms separately.
- Media storage failure must not prevent saving the message text — retain/add failure-path coverage.
- Local Wrangler configs may point at real remote D1/KV — tests must avoid unintended remote mutations and no live deploy/provisioning commands are allowed.

---

### Task 1: Establish a safe baseline

**Files:**
- Read: Git status, root and app package scripts, Wrangler templates and ignored local configs (configuration only; do not inspect secrets).
- Create: `docs/superpowers/plans/2026-10-20-replyloom-manual-inbox.md` (this plan).

**Interfaces:**
- Consumes: current branch `chore/free-tier-cloudflare-setup` and existing working tree.
- Produces: reproducible baseline and a documented rollback point without overwriting user changes.

- [ ] Record branch, HEAD, and modified/untracked files.
- [ ] Run worker and web tests/typechecks before behavior changes; capture failures without changing files.
- [ ] Confirm the latest stable commit and verify local config backups exist without opening secret files.
- [ ] Do not stage any existing user changes.

### Task 2: Add regression coverage for manual-only inbound processing

**Files:**
- Modify: `apps/worker/src/session/message-events.ts`
- Test: new `apps/worker/src/__tests__/manual-inbox.test.ts` (or existing message-events test if present).

**Interfaces:**
- Consumes: `processLiveMessage(ctx, msg, upsertType)`.
- Produces: inbound message persistence/broadcast without calls to `socket.sendMessage`, `findAutoReply`, `maybeAiAutoReply`, webhook dispatch or semantic indexing.

- [ ] Write failing tests for incoming `notify` and `append` events asserting zero outbound sends.
- [ ] Add tests proving a `fromMe` message is synced/broadcast but never auto-sent.
- [ ] Run only the new test file and verify the inbound auto-send regression is exposed.
- [ ] Remove inbound webhook/search/auto-reply side effects from the live-message path; retain D1 sync and realtime broadcast. Keep best-effort media download only if the existing feature requires it and its limits/cost are verified.
- [ ] Run the new tests and relevant worker tests.

### Task 3: Remove AI execution and automation infrastructure from active runtime

**Files:**
- Modify: `apps/worker/src/index.ts`, `apps/worker/src/session/message-events.ts`, `apps/worker/src/automation.ts`, `apps/worker/src/scheduler.ts`, `apps/worker/wrangler.jsonc` (tracked template only).
- Review: `apps/worker/src/broadcast.ts`, `apps/worker/src/ai-autoreply.ts`, `apps/worker/src/search.ts`.

**Interfaces:**
- Consumes: Worker fetch routes, session Durable Object, D1 schema and current outbound guard.
- Produces: only session management, inbound sync, conversation retrieval and explicit manual-send routes active in runtime.

- [ ] Add failing tests for removed/disabled automation endpoints and ensure incoming messages never invoke agent functions.
- [ ] Remove or return a clear `404` for AI, agent, search/reindex, broadcast and schedule routes not needed by manual inbox.
- [ ] Remove queue consumer, AI/Vectorize/REPLY_CACHE bindings and campaign queue configuration only after static references are removed and build typing is updated.
- [ ] Remove campaign/scheduled-message dispatch and webhook retries from Scheduler. Preserve any session watchdog alarm logic needed for stable WhatsApp connectivity.
- [ ] Keep existing D1 tables and cloud resources intact; no DROP or resource deletion.
- [ ] Run worker tests, typecheck, lint and Wrangler dry-run build without deployment.

### Task 4: Simplify web navigation and prevent access to automation screens

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`, relevant route guards in `apps/web/src/routes/_app/automation.tsx`, `broadcasts.tsx`, `search.tsx`, `pipeline.tsx` as needed.
- Review: inbox, integrations, contacts and settings routes.

**Interfaces:**
- Consumes: existing authenticated layout and workspace context.
- Produces: primary navigation focused on Inbox and Integrations, with Contacts/Settings only if useful to manual messaging.

- [ ] Add/adjust route tests for automation and broadcast pages so hidden navigation is not the only access control.
- [ ] Remove Automation, Broadcasts, Pipeline and AI/Search from the active navigation; keep Inbox and Integrations.
- [ ] Ensure removed pages cannot still trigger automation mutations through exposed server functions.
- [ ] Run web tests, typecheck, lint and build.

### Task 5: Verify cost safety and deployment readiness without deploying

**Files:**
- Review: `apps/web/wrangler.jsonc`, `apps/worker/wrangler.jsonc`, deployment scripts and current Cloudflare resource bindings.
- Update: docs only if the actual plan/limits are verified.

**Interfaces:**
- Consumes: completed local changes and configuration inventory.
- Produces: evidence-based go/no-go decision; no resource creation.

- [ ] Verify current Cloudflare plan and whether Workers rate-limit bindings, D1, KV and Durable Objects are usable within the user's no-charge requirement.
- [ ] Do not call AI, Vectorize, queue producers, resource creation or deploy commands during verification.
- [ ] If account cost cannot be confirmed, explicitly mark deployment blocked rather than infer the free tier.
- [ ] Confirm the exact rollback procedure from the current stable deployment and check that the current production version is identifiable.
- [ ] Run worker and web tests, typechecks, lint and builds; inspect diffs for accidental changes/secrets.
- [ ] Commit only feature changes in small, scoped commits; leave unrelated user changes unstaged.

### Task 6: End-to-end acceptance and final decision

- [ ] Verify the inbox loads and conversations are visible using a safe test environment.
- [ ] If a real WhatsApp test is available, verify QR connect, inbound message and explicit manual reply; do not send test messages to a customer.
- [ ] Verify no incoming event causes a reply and no AI/automation/campaign/scheduler execution remains active.
- [ ] Deploy only if the no-charge requirement is proven and rollback is prepared. Otherwise report local changes and the specific account/plan blocker without deploying.

## Self-review

- Every requirement in the spec is assigned to Tasks 2–6.
- No task provisions or deletes a Cloudflare resource.
- Existing local WhatsApp fixes and backup files are explicitly protected.
- Session watchdog behavior is treated separately from scheduled-message automation so connectivity is not accidentally broken.
- Account cost uncertainty is a hard deploy gate, not an assumption.
