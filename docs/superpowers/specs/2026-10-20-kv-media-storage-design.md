# ReplyLoom media storage on free Cloudflare KV

Date: 2026-10-20
Status: Proposed implementation specification
Scope: Replace R2-backed media persistence with a dedicated KV namespace, without provisioning or enabling any potentially billable service.

## Goals

- Keep ReplyLoom media features working on the free Cloudflare plan.
- Store only media objects up to 5 MiB in a dedicated KV namespace shared by the web app and worker.
- Preserve existing media-key conventions and workspace authorization.
- Fail safely when media exceeds the storage cap or KV operations fail.
- Add automated tests for storage limits, metadata, access isolation, and failure paths.

## Non-goals

- Enabling or creating an R2 bucket.
- Promising durable object-storage semantics from KV.
- Persisting arbitrary large WhatsApp attachments.
- Deploying the change to production as part of this implementation.

## Architecture

Create a distinct KV binding named MEDIA_KV for both `apps/web` and `apps/worker`. Keep it separate from REPLY_CACHE so media payloads do not compete with cache entries. Store each object as a base64-encoded envelope containing the media bytes, MIME type, and a version marker; enforce a hard 5 MiB binary payload limit before encoding. Because base64 increases payload size and KV has value-size constraints, the implementation must verify encoded envelope size against the platform limit and reject anything that cannot safely fit. Do not split objects across keys in this first iteration.

A small shared helper should own encoding/decoding, size validation, content-type validation, and KV error translation. Route handlers remain responsible for workspace authorization and HTTP semantics. Do not store data URLs or client-supplied arbitrary metadata.

## Behavior

- Uploads at or below 5 MiB may be stored; larger uploads return a clear 413 response.
- Reads decode the envelope and return its MIME type with safe cache/security headers.
- Deletes remove the corresponding key from KV.
- WhatsApp media downloads read from KV and use the recorded MIME type.
- For outbound WhatsApp attachments above the storage cap, do not persist a copy. Preserve the existing send flow only if it already has the original bytes available and does not require the media key for delivery; otherwise return a clear validation error rather than claiming success.
- KV failures must not be silently treated as successful persistence. Existing messaging behavior should not lose a message solely because optional media archival failed; this must be explicit in the relevant send path.
- Maintain workspace scoping in media keys and authorization checks for every route.
- KV is eventually consistent and not a durable object store. Document that freshly written media may not be immediately visible at every edge, and handle missing reads safely.

## Configuration and cost guardrails

- Remove R2 bindings from the tracked Wrangler templates and local ignored configs where appropriate; never run R2 bucket creation or activation commands.
- Add MEDIA_KV to the web and worker config templates and setup logic so both apps point to the same dedicated namespace.
- Reuse an existing namespace only if it is dedicated to media; do not reuse REPLY_CACHE.
- Do not provision any resource with uncertain billing status. No deployment or production resource creation is included in this change.
- Document free-tier limits and that quotas can change; the 5 MiB per-object cap is an application limit, not a guarantee of unlimited free storage.

## Tests

- Helper tests: encode/decode round-trip, MIME metadata, exact-limit acceptance, over-limit rejection, invalid envelope, KV read/write/delete errors.
- Worker tests: media upload limit, read and delete behavior, workspace isolation, outbound attachment handling when over the cap, and KV outage behavior.
- Web tests: media serving and avatar upload behavior with the new binding, including missing media and oversized uploads.
- Run relevant tests first, then all worker and web tests, lint/typecheck/build as supported by the repository.
- Verify config templates and generated/local configs no longer require R2 before considering the change ready.

## Rollout and rollback

This change remains local until explicitly requested and verified. Preserve the current Git branch and changes. Rollback is a Git revert to the pre-change commit; no production migration or deletion of an existing R2 bucket is part of this work. Existing R2-stored media will not automatically migrate to KV and needs an explicit migration plan before any production cutover.
