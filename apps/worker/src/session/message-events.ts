// Turns Baileys upserts into D1 rows and broadcasts live updates to the manual inbox.
// This module never sends replies or triggers automation.
import type {Db} from "@workspace/db";
import type { WASocket } from "@whiskeysockets/baileys";
import type { Env } from "../index";
import { parseBaileysMessage, syncIncomingMessage, syncMessagesBatch, isContactBlocked  } from "../db/sync";
import type {ParsedMessage} from "../db/sync";
import { downloadAndStoreMedia } from "../media";

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];

type LogFn = (level: "info" | "warn" | "error", msg: string) => void;

export interface MessageEventContext {
  db: Db;
  env: Env;
  socket: WASocket | null;
  sessionIdName: string;
  workspaceId: string;
  log: LogFn;
  broadcast: (data: Record<string, unknown>) => void;
}

/**
 * Parses one live message, checks blocked contacts, stores optional media,
 * persists the message, and broadcasts it to the manual inbox.
 * Inbound events never trigger outbound messages or automation.
 */
export async function processLiveMessage(
  ctx: MessageEventContext,
  msg: any,
  upsertType: "notify" | "append"
): Promise<void> {
  const parsed = await parseBaileysMessage(ctx.db, ctx.sessionIdName, msg);
  if (!parsed) return;

  // No message text in logs: it's customer PII, and at scale one log line
  // per message is already the dominant log volume.
  ctx.log("info", `${parsed.fromMe ? "OUT" : "IN"} [${parsed.type}] ${parsed.waMessageId}`);

  // Skip all processing for incoming messages from blocked contacts —
  // no conversation, no sync, no auto-reply, nothing.
  if (!parsed.fromMe) {
    const senderJid = parsed.participant ?? parsed.remoteJid;
    if (await isContactBlocked(ctx.db, ctx.sessionIdName, senderJid)) {
      ctx.log("info", `Blocked contact ${senderJid} — message dropped`);
      return;
    }
  }

  // Photo/video/voice-note/document/sticker -- fetch the actual bytes
  // into KV before we save the row, so the CRM inbox can render it
  // inline like WhatsApp Web does instead of a bare "[image]"
  // placeholder. Best-effort: a failure here still lets the message
  // through, just without media attached.
  if (MEDIA_TYPES.includes(parsed.type) && ctx.socket) {
    const media = await downloadAndStoreMedia(
      ctx.socket,
      ctx.env,
      ctx.workspaceId,
      ctx.sessionIdName,
      parsed.waMessageId,
      msg,
      parsed.type
    );
    if (media) {
      parsed.mediaKey = media.mediaKey;
      parsed.mediaMime = media.mediaMime;
      parsed.mediaMeta = media.mediaMeta;
    }
  }

  let conversationId: string;
  try {
    conversationId = await syncIncomingMessage(ctx.db, ctx.workspaceId, ctx.sessionIdName, parsed);
  } catch (err: any) {
    ctx.log("error", `D1 sync failed for message ${parsed.waMessageId}: ${err?.message || err}`);
    return;
  }

  // Broadcast to WebSocket subscribers so the CRM inbox updates in real-time.
  // Includes conversationPatch so the client can optimistically update the
  // conversation list without a D1 query.
  ctx.broadcast({
    type: "new-message",
    sessionId: ctx.sessionIdName,
    workspaceId: ctx.workspaceId,
    conversationId,
    message: {
      remoteJid: parsed.remoteJid,
      fromMe: parsed.fromMe,
      type: parsed.type,
      body: parsed.body,
      waMessageId: parsed.waMessageId,
      timestampMs: parsed.timestampMs,
      pushName: parsed.pushName ?? null,
      // "append" = backfill/offline catch-up; the web app only raises
      // desktop notifications for live traffic.
      upsertType,
    },
    conversationPatch: {
      lastBody: parsed.body ?? null,
      lastType: parsed.type,
      lastDirection: parsed.fromMe ? "out" : "in",
      lastMessageAt: parsed.timestampMs,
      unreadCountDelta: !parsed.fromMe ? 1 : 0,
    },
  });

  // Manual-only mode: inbound messages are persisted and broadcast to the inbox.
  // They must never trigger outbound webhooks, search/AI indexing, or replies.

}

/**
 * Handles `messaging-history.set`'s `hist.messages` -- the actual chat
 * history Baileys sends on initial connect. Previously this array was
 * logged and discarded entirely, so a freshly connected session never
 * got any message history into D1, only messages that arrived live
 * afterward.
 *
 * Bulk historical sync intentionally skips the live-only side effects
 * (media download, websocket broadcast, outbound actions): replaying potentially
 * thousands of old events through those would flood the CRM UI or trigger
 * external side effects for a user's entire chat history. It writes through
 * the same parse + de-duped upsert path as live messages, so a message
 * that arrives live after history sync (or a second history sync) is a
 * no-op rather than a duplicate.
 */
export async function syncMessagesFromHistory(
  db: Db,
  workspaceId: string,
  waSessionId: string,
  historyMessages: any[],
  log: LogFn
): Promise<void> {
  log("info", `Syncing ${historyMessages.length} history messages...`);
  let skipped = 0;
  const parsedAll: ParsedMessage[] = [];
  for (const msg of historyMessages) {
    try {
      const parsed = await parseBaileysMessage(db, waSessionId, msg);
      if (parsed) parsedAll.push(parsed);
      else skipped++;
    } catch (err: any) {
      skipped++;
      log("error", `syncMessagesFromHistory parse failed for ${msg?.key?.id}: ${err?.message || err}`);
    }
  }
  // bumpUnread: false -- see syncIncomingMessage's opts doc. Batched: one
  // resolve per chat, 25 messages per D1 round trip.
  const { synced, failed } = await syncMessagesBatch(db, workspaceId, waSessionId, parsedAll, {
    bumpUnread: false,
  });
  skipped += failed;
  log("info", `Synced ${synced} history messages (${skipped} skipped/failed) for session ${waSessionId}`);
}
