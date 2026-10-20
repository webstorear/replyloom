import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_BYTES,
  isWorkspaceMediaKey,
  deleteMedia,
  readMedia,
  storeMedia,
} from "../../../../packages/media-storage/src/index";

function memoryKv() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
  };
}

describe("KV media storage", () => {
  it("isolates media keys by workspace", () => {
    expect(isWorkspaceMediaKey("workspace-a", "workspace-a/session/file.png")).toBe(true);
    expect(isWorkspaceMediaKey("workspace-a", "workspace-b/session/file.png")).toBe(false);
    expect(isWorkspaceMediaKey("workspace-a", "workspace-a/../other/file.png")).toBe(false);
  });

  it("round-trips bytes and MIME metadata", async () => {
    const kv = memoryKv();
    const input = new Uint8Array([0, 1, 2, 127, 128, 255]);
    await storeMedia(kv, "workspace-a/media.png", input, "image/png");
    const result = await readMedia(kv, "workspace-a/media.png");
    expect(result?.mime).toBe("image/png");
    expect([...new Uint8Array(result!.bytes)]).toEqual([...input]);
  });

  it("accepts the exact binary size limit and rejects anything larger", async () => {
    const kv = memoryKv();
    const exact = new Uint8Array(MAX_MEDIA_BYTES);
    await storeMedia(kv, "w/exact.bin", exact, "application/octet-stream");
    await expect(storeMedia(kv, "w/large.bin", new Uint8Array(MAX_MEDIA_BYTES + 1), "application/octet-stream"))
      .rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });

  it("rejects invalid MIME values and corrupt or unsupported envelopes", async () => {
    const kv = memoryKv();
    await expect(storeMedia(kv, "w/bad", new Uint8Array([1]), "text/html\r\nX-Bad: yes"))
      .rejects.toMatchObject({ code: "INVALID_MEDIA_MIME" });
    kv.values.set("w/corrupt", "{not-json");
    await expect(readMedia(kv, "w/corrupt")).rejects.toMatchObject({ code: "INVALID_MEDIA_ENVELOPE" });
    kv.values.set("w/old", JSON.stringify({ version: 99, mime: "image/png", data: "AQ==" }));
    await expect(readMedia(kv, "w/old")).rejects.toMatchObject({ code: "INVALID_MEDIA_ENVELOPE" });
  });

  it("returns null for missing keys and deletes media", async () => {
    const kv = memoryKv();
    expect(await readMedia(kv, "w/missing")).toBeNull();
    await storeMedia(kv, "w/a.png", new Uint8Array([1]), "image/png");
    await deleteMedia(kv, "w/a.png");
    expect(await readMedia(kv, "w/a.png")).toBeNull();
  });

  it("surfaces KV read, write and delete failures", async () => {
    const broken = {
      async get() { throw new Error("read unavailable"); },
      async put() { throw new Error("write unavailable"); },
      async delete() { throw new Error("delete unavailable"); },
    };
    await expect(storeMedia(broken, "w/a", new Uint8Array([1]), "image/png"))
      .rejects.toThrow("write unavailable");
    await expect(readMedia(broken, "w/a")).rejects.toThrow("read unavailable");
    await expect(deleteMedia(broken, "w/a")).rejects.toThrow("delete unavailable");
  });
});
