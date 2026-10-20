export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const MAX_KV_VALUE_BYTES = 25 * 1024 * 1024;

export interface MediaKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}
export type StoredMedia = { bytes: ArrayBuffer; mime: string };

export function isWorkspaceMediaKey(workspaceId: string, key: string): boolean {
  return Boolean(workspaceId) && key.startsWith(`${workspaceId}/`) && !key.includes("..");
}

type MediaEnvelope = { version: 1; mime: string; data: string };
export type MediaStorageErrorCode = "MEDIA_TOO_LARGE" | "INVALID_MEDIA_MIME" | "INVALID_MEDIA_ENVELOPE" | "MEDIA_VALUE_TOO_LARGE";

export class MediaStorageError extends Error {
  constructor(public readonly code: MediaStorageErrorCode, message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

function validateMime(mime: string): string {
  const normalized = mime.trim();
  if (!normalized || normalized.length > 255 || /[\r\n\0]/.test(normalized) ||
      !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;\s*[^;\r\n]+)*$/.test(normalized)) {
    throw new MediaStorageError("INVALID_MEDIA_MIME", "Invalid media content type");
  }
  return normalized;
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid base64");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function isEnvelope(value: unknown): value is MediaEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<MediaEnvelope>;
  return envelope.version === 1 && typeof envelope.mime === "string" && typeof envelope.data === "string";
}

export async function storeMedia(kv: MediaKv, key: string, input: ArrayBuffer | ArrayBufferView, mime: string): Promise<void> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaStorageError("MEDIA_TOO_LARGE", "Media exceeds the 5 MiB storage limit");
  const envelope: MediaEnvelope = { version: 1, mime: validateMime(mime), data: encodeBase64(bytes) };
  const serialized = JSON.stringify(envelope);
  if (new TextEncoder().encode(serialized).byteLength > MAX_KV_VALUE_BYTES) {
    throw new MediaStorageError("MEDIA_VALUE_TOO_LARGE", "Encoded media exceeds the KV value limit");
  }
  await kv.put(key, serialized);
}
export async function readMedia(kv: MediaKv, key: string): Promise<StoredMedia | null> {
  const serialized = await kv.get(key);
  if (serialized === null) return null;
  try {
    const envelope: unknown = JSON.parse(serialized);
    if (!isEnvelope(envelope)) throw new Error("Unsupported media envelope");
    const mime = validateMime(envelope.mime);
    if (envelope.data.length > 4 * Math.ceil(MAX_MEDIA_BYTES / 3)) throw new Error("Encoded media exceeds application limit");
    const bytes = decodeBase64(envelope.data);
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("Media exceeds application limit");
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return { bytes: copy.buffer, mime };
  } catch {
    throw new MediaStorageError("INVALID_MEDIA_ENVELOPE", "Stored media is corrupt or unsupported");
  }
}
export async function deleteMedia(kv: MediaKv, key: string): Promise<void> {
  await kv.delete(key);
}
