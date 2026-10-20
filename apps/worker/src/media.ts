// Downloads WhatsApp media via Baileys and stores bounded copies in the
// dedicated MEDIA_KV namespace. D1 holds keys and lightweight metadata only.
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import type { MediaMeta } from "@workspace/db";
import { storeMedia } from "@workspace/media-storage";
import type { Env } from "./index";
import type { IncomingType } from "./db/sync";
import { scopedLogger } from "./logger";

const log = scopedLogger("media");

const MIME_EXT: Record<string, string | undefined> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/ogg; codecs=opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

function extFor(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback;
  const subtype = mime.split("/")[1] as string | undefined;
  return MIME_EXT[mime] ?? subtype?.split(";")[0] ?? fallback;
}

/** Pulls whatever per-type extras Baileys attaches to the raw message content. */
function extractMediaMeta(content: any, type: IncomingType): MediaMeta {
  switch (type) {
    case "image": {
      const m = content.imageMessage;
      return { width: m?.width, height: m?.height };
    }
    case "video": {
      const m = content.videoMessage;
      return { width: m?.width, height: m?.height, durationSeconds: m?.seconds };
    }
    case "audio": {
      const m = content.audioMessage;
      return { durationSeconds: m?.seconds, ptt: !!m?.ptt };
    }
    case "document": {
      const m = content.documentMessage;
      return { fileName: m?.fileName, fileSizeBytes: m?.fileLength ? Number(m.fileLength) : undefined };
    }
    case "sticker": {
      const m = content.stickerMessage;
      return { width: m?.width, height: m?.height, isAnimated: !!m?.isAnimated };
    }
    default:
      return {};
  }
}

/**
 * Best-effort archival: WhatsApp CDN media can expire and KV can be
 * unavailable. A persistence failure must not fail message synchronization.
 */
export async function downloadAndStoreMedia(
  sock: WASocket,
  env: Env,
  workspaceId: string,
  waSessionId: string,
  waMessageId: string,
  msg: any,
  type: IncomingType,
): Promise<{ mediaKey: string; mediaMime: string; mediaMeta: MediaMeta } | null> {
  if (type === "text") return null;
  const content = msg?.message;
  if (!content) return null;

  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: console as any, reuploadRequest: sock.updateMediaMessage },
    );
    const contentKey: Record<string, string> = {
      image: "imageMessage",
      video: "videoMessage",
      audio: "audioMessage",
      document: "documentMessage",
      sticker: "stickerMessage",
    };
    const typedMessage = content[contentKey[type]];
    const mime: string = typedMessage?.mimetype ?? "application/octet-stream";
    const mediaKey = `${workspaceId}/${waSessionId}/${waMessageId}.${extFor(mime, type)}`;
    await storeMedia(env.MEDIA_KV, mediaKey, buffer, mime);
    return { mediaKey, mediaMime: mime, mediaMeta: extractMediaMeta(content, type) };
  } catch (err: any) {
    log.error({ err, waMessageId, type }, "downloadAndStoreMedia failed");
    return null;
  }
}

/** Store an outbound attachment after sendMessage succeeds. */
export async function storeOutgoingMedia(
  env: Env,
  workspaceId: string,
  waSessionId: string,
  waMessageId: string,
  buffer: ArrayBuffer,
  mime: string,
  type: Exclude<IncomingType, "text">,
  fileName?: string,
): Promise<{ mediaKey: string; mediaMime: string; mediaMeta: MediaMeta }> {
  const mediaKey = `${workspaceId}/${waSessionId}/${waMessageId}.${extFor(mime, type)}`;
  await storeMedia(env.MEDIA_KV, mediaKey, buffer, mime);
  const mediaMeta: MediaMeta =
    type === "document"
      ? { fileName, fileSizeBytes: buffer.byteLength }
      : type === "audio"
        ? { ptt: false }
        : {};
  return { mediaKey, mediaMime: mime, mediaMeta };
}

/** Map MIME to the Baileys content type used by template sends. */
export function mediaTypeFromMime(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Store a template attachment in the workspace-scoped media library. */
export async function storeLibraryMedia(
  env: Env,
  workspaceId: string,
  buffer: ArrayBuffer,
  mime: string,
): Promise<{ mediaKey: string; mediaMime: string; mediaType: "image" | "video" | "audio" | "document" }> {
  const type = mediaTypeFromMime(mime);
  const mediaKey = `${workspaceId}/templates/${crypto.randomUUID()}.${extFor(mime, type)}`;
  await storeMedia(env.MEDIA_KV, mediaKey, buffer, mime);
  return { mediaKey, mediaMime: mime, mediaType: type };
}
