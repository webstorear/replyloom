import { beforeEach, describe, expect, it, vi } from "vitest";
import { processLiveMessage } from "../session/message-events";

const deps = vi.hoisted(() => ({
  parseBaileysMessage: vi.fn(),
  syncIncomingMessage: vi.fn(),
  isContactBlocked: vi.fn(),
  downloadAndStoreMedia: vi.fn(),
  findAutoReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  maybeAiAutoReply: vi.fn(),
  indexMessageForSearch: vi.fn(),
}));

vi.mock("../db/sync", () => ({
  parseBaileysMessage: deps.parseBaileysMessage,
  syncIncomingMessage: deps.syncIncomingMessage,
  isContactBlocked: deps.isContactBlocked,
  syncMessagesBatch: vi.fn(),
}));
vi.mock("../media", () => ({ downloadAndStoreMedia: deps.downloadAndStoreMedia }));
vi.mock("../automation", () => ({
  findAutoReply: deps.findAutoReply,
  dispatchWebhookEvent: deps.dispatchWebhookEvent,
}));
vi.mock("../ai-autoreply", () => ({ maybeAiAutoReply: deps.maybeAiAutoReply }));
vi.mock("../search", () => ({ indexMessageForSearch: deps.indexMessageForSearch }));


const parsedIncoming = {
  waMessageId: "msg-in-1",
  remoteJid: "5491100000000@s.whatsapp.net",
  fromMe: false,
  type: "text",
  body: "Hola",
  timestampMs: Date.now(),
};

function context() {
  return {
    db: {} as never,
    env: {} as never,
    socket: { sendMessage: vi.fn().mockResolvedValue({ key: { id: "auto-reply" } }) } as never,
    sessionIdName: "session-1",
    workspaceId: "workspace-1",
    log: vi.fn(),
    broadcast: vi.fn(),
  };
}

describe("manual-only inbox message processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.parseBaileysMessage.mockResolvedValue({ ...parsedIncoming });
    deps.isContactBlocked.mockResolvedValue(false);
    deps.syncIncomingMessage.mockResolvedValue("conversation-1");
    deps.findAutoReply.mockResolvedValue("Respuesta automática");
    deps.dispatchWebhookEvent.mockResolvedValue(undefined);
    deps.maybeAiAutoReply.mockResolvedValue("Respuesta de IA");
    deps.indexMessageForSearch.mockResolvedValue(undefined);
  });

  it.each(["notify", "append"] as const)(
    "never sends an automatic reply for inbound %s messages",
    async (upsertType) => {
      const ctx = context();
      await processLiveMessage(ctx, { key: { id: "msg-in-1" } }, upsertType);
      expect((ctx.socket as any).sendMessage).not.toHaveBeenCalled();
      expect(deps.findAutoReply).not.toHaveBeenCalled();
      expect(deps.maybeAiAutoReply).not.toHaveBeenCalled();
      expect(deps.syncIncomingMessage).toHaveBeenCalledOnce();
      expect(ctx.broadcast).toHaveBeenCalledOnce();
    },
  );

  it("syncs and broadcasts own messages without sending anything", async () => {
    deps.parseBaileysMessage.mockResolvedValue({ ...parsedIncoming, fromMe: true });
    const ctx = context();
    await processLiveMessage(ctx, { key: { id: "msg-out-1" } }, "append");
    expect((ctx.socket as any).sendMessage).not.toHaveBeenCalled();
    expect(deps.syncIncomingMessage).toHaveBeenCalledOnce();
    expect(ctx.broadcast).toHaveBeenCalledOnce();
  });

  it("does not dispatch outbound webhooks or semantic indexing for inbound messages", async () => {
    await processLiveMessage(context(), { key: { id: "msg-in-1" } }, "notify");
    expect(deps.dispatchWebhookEvent).not.toHaveBeenCalled();
    expect(deps.indexMessageForSearch).not.toHaveBeenCalled();
  });
});
