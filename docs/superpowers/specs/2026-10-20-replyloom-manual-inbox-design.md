# ReplyLoom manual inbox design

Draft specification for a manual-only WhatsApp inbox. No automatic replies, AI, campaigns, scheduled messages, or billable resources. Preserve current local changes and do not deploy until account costs are verified.
 
## Goals and requirements

- Preserve authentication, workspace isolation, session ownership validation, QR connection, inbound messages, conversation list and manually initiated replies.
- Disable keyword auto-replies and AI agent execution. Incoming messages must never cause an outbound reply.
- Disable campaigns/broadcasts, scheduled messages, retry webhooks and any scheduler/cron not essential to a live manual session.
- Avoid Workers AI, AI Gateway and Vectorize. Do not provision or enable resources that may incur charges.
- Keep media storage optional and bounded; failure to store media must not lose the text message.
- Do not delete existing databases, namespaces, sessions, tables or stored data as part of this change.
- Preserve uncommitted WhatsApp connection changes and backup files. Never display, read into logs, or commit secrets.
- Do not deploy until the actual Cloudflare plan, enabled resources and possible charges are verified. If zero cost cannot be established, leave changes local and report the blocker.

## Architecture

Keep apps/web as the interface/authentication Worker and apps/worker as the WhatsApp session engine. Retain D1 and Durable Objects only as required for inbox, auth and WhatsApp session state. The UI exposes conversation viewing and manual send; the engine accepts outbound messages only through authenticated, workspace-authorized manual actions. Remove AI, campaign and scheduling code from active paths, but do not drop schemas or cloud resources without a separate inventory and verified backup.

## Security and failure handling

- All outbound messages require an authenticated user, validated workspace and a session owned by that workspace.
- Incoming events must not trigger auto replies, campaigns or external actions.
- Media KV errors must not discard the text message.
- No destructive migrations, resource deletion or production deployment without verified backup and rollback.
- Do not promise zero cost until account and resource state are verified.

 
## Acceptance and verification

1. Tests prove an inbound message does not cause any outbound send.
2. Tests prove authorized manual sends work and unauthorized sends are rejected.
3. Typecheck, lint and builds for both apps pass, distinguishing existing Wrangler temporary-artifact lint errors from source errors.
4. Config and code review confirm no active AI/Vectorize, campaign or unnecessary scheduler execution.
5. Inbox supports viewing conversations and manually sending a reply.
6. Do not claim end-to-end WhatsApp works without a real QR connection, inbound message and manual outbound reply test.
7. Deploy only after zero-cost status is verified and rollback is prepared; otherwise leave changes undeployed.
