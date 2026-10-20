import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { downloadAndStoreMedia, storeLibraryMedia, storeOutgoingMedia } from "../media";
import type { Env } from "../index";

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, { downloadMediaMessage: vi.fn() });
});

function makeEnv(put: (key: string, value: string) => Promise<unknown> = async () => {}) {
  const values = new Map<string, string>();
  const MEDIA_KV = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) { await put(key, value); values.set(key, value); },
    async delete(key: string) { values.delete(key); },
  };
  return { env: { MEDIA_KV } as unknown as Env, values, MEDIA_KV };
}

describe("worker media persistence", () => {
  beforeEach(() => vi.mocked(downloadMediaMessage).mockReset());

  it("stores downloaded inbound media under the workspace/session/message key", async () => {
    const { env, values } = makeEnv();
    vi.mocked(downloadMediaMessage).mockResolvedValue(new Uint8Array([1, 2, 3]) as never);
    const result = await downloadAndStoreMedia(
      { updateMediaMessage: vi.fn() } as never,
      env,
      "workspace-a",
      "session-a",
      "message-a",
      { message: { imageMessage: { mimetype: "image/png" } } },
      "image",
    );
    expect(result?.mediaKey).toBe("workspace-a/session-a/message-a.png");
    expect(result?.mediaMime).toBe("image/png");
    expect(values.has("workspace-a/session-a/message-a.png")).toBe(true);
  });

  it("keeps inbound synchronization best-effort when KV writes fail", async () => {
    const { env } = makeEnv(async () => { throw new Error("KV unavailable"); });
    vi.mocked(downloadMediaMessage).mockResolvedValue(new Uint8Array([1]) as never);
    const result = await downloadAndStoreMedia(
      { updateMediaMessage: vi.fn() } as never,
      env,
      "workspace-a",
      "session-a",
      "message-a",
      { message: { imageMessage: { mimetype: "image/png" } } },
      "image",
    );
    expect(result).toBeNull();
  });

  it("stores template library media and returns its MIME/type metadata", async () => {
    const { env, values } = makeEnv();
    const result = await storeLibraryMedia(env, "workspace-a", new Uint8Array([1, 2]).buffer, "image/webp");
    expect(result.mediaType).toBe("image");
    expect(result.mediaMime).toBe("image/webp");
    expect(values.has(result.mediaKey)).toBe(true);
  });

  it("rejects oversize outgoing archival without changing the send contract", async () => {
    const { env, values } = makeEnv();
    await expect(storeOutgoingMedia(
      env,
      "workspace-a",
      "session-a",
      "message-a",
      new Uint8Array(5 * 1024 * 1024 + 1).buffer,
      "application/octet-stream",
      "document",
    )).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
    expect(values.size).toBe(0);
  });
});
