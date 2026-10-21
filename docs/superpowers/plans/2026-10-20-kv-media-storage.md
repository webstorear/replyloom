# Plan: KV media storage (free tier)

**Spec:** docs/superpowers/specs/2026-10-20-kv-media-storage-design.md
**Scope:** Replace R2 media persistence with a dedicated Cloudflare KV namespace, 5 MiB application limit. No deploy, no R2 creation/activation, no paid resources.

## Global constraints
- Preserve workspace isolation, auth checks, MIME handling and cache safety.
- Do not log media bytes, secrets, or full base64 payloads.
- Keep incoming-media persistence best-effort; never break message sync because KV is unavailable.
- Do not turn a post-send persistence failure into a false report that WhatsApp sending failed.
- One KV value per media object; versioned envelope; reject serialized values exceeding KV limits.
- Existing R2 objects are not migrated or deleted in this work.
- Verify source templates, not just ignored/generated Wrangler files.

## Task 1 — Shared KV media codec and tests
1. Inspect workspace conventions and source media/config references.
2. Add failing unit tests for envelope round-trip, MIME preservation, invalid envelope, size cap, missing key and KV errors.
3. Implement a small shared media-storage module in an existing appropriate package (or a dedicated package only if repo conventions support it); avoid importing worker code from web.
4. Run focused tests and package typecheck.
5. Commit: `feat: add bounded KV media storage`.

## Task 2 — Worker incoming/outgoing/library persistence
1. Add failing tests for inbound download persistence, oversize rejection, KV write failure being best-effort, and outgoing/library behavior.
2. Replace worker R2 calls with the shared KV abstraction; retain message metadata and workspace-prefixed keys.
3. Enforce 5 MiB on upload/send boundaries. Oversize outgoing media must not produce a post-send false negative; document/implement the safe existing flow.
4. Run focused tests, worker test suite and typecheck.
5. Commit: `feat: store worker media in KV`.

## Task 3 — Worker media HTTP endpoints and session sends
1. Add/update tests for GET/POST/DELETE media endpoint, 413 oversize, missing key, workspace isolation and safe MIME/cache headers.
2. Replace R2-specific object/etag behavior with KV-compatible responses; do not claim KV supports R2 conditional semantics.
3. Update WhatsApp session media reads to decode the versioned envelope and handle missing/corrupt values safely.
4. Run focused tests, worker suite and typecheck.
5. Commit: `feat: serve media from KV`.

## Task 4 — Web app and bindings
1. Add tests for media read/cache behavior and avatar write/delete, including KV failures.
2. Migrate web media reads and avatar storage/deletion to the shared KV abstraction.
3. Update tracked Wrangler config templates and type bindings to dedicated MEDIA_KV; do not reuse REPLY_CACHE.
4. Keep local ignored configuration/secrets untouched unless a strictly necessary local binding update is identified; never display or stage secrets.
5. Run web tests, typecheck, lint and build.
6. Commit: `feat: migrate web media storage to KV`.

## Task 5 — Full verification and review
1. Search tracked source/config/docs for remaining media R2 bindings and calls; distinguish unrelated R2 references from the media feature.
2. Run worker/web tests, lint, typecheck and builds; inspect full outputs and git diff.
3. Review security, isolation, quota/size handling, partial failures and UI behavior.
4. Update documentation and migration notes, explicitly stating no R2 migration and no deployment performed.
5. Commit final docs/fixes only after tests pass. Do not push or deploy without explicit authorization.

## Review focus
- Cloudflare KV eventual consistency and value size limits.
- Base64 expansion and JSON envelope size calculation.
- Never leak cross-workspace media through keys or authorization.
- Do not report a WhatsApp send as failed if it was sent but optional persistence failed.
- Avoid deleting R2 resources or activating services with potential cost.
