import { describe, expect, it, vi } from "vitest";
import { route } from "../index";

describe("manual-only worker routes", () => {
  it.each([
    ["POST", "/broadcast/campaign-1/start"],
    ["POST", "/search"],
    ["POST", "/search/reindex"],
    ["POST", "/agent/reply"],
    ["POST", "/agent/ingest"],
    ["GET", "/agent/config?workspaceId=workspace-1"],
    ["GET", "/agent/tools?workspaceId=workspace-1"],
    ["POST", "/schedule/arm"],
  ] as const)("returns 404 for disabled %s %s endpoint", async (method, path) => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const env = {
      API_RATE_LIMITER: { limit },
      AUTH_RATE_LIMITER: { limit },
      CORS_ORIGIN: "http://localhost:3000",
    } as any;

    const response = await route(new Request(`https://worker.test${path}`, { method }), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Disabled in manual-only mode" });
  });
});
