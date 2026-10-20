import type { Env } from "./index";

/**
 * Legacy Durable Object class retained so existing Cloudflare migrations remain valid.
 * Manual-only mode deliberately disables scheduling without deleting stored records.
 */
export class Scheduler implements DurableObject {
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    // Existing alarms are harmless; scheduled sends and webhook retries are disabled.
  }
}
