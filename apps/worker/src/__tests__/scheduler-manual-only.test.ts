import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "../scheduler";

describe("manual-only scheduler", () => {
  it("does not arm or dispatch scheduled automation", async () => {
    const setAlarm = vi.fn();
    const state = { storage: { setAlarm } } as unknown as DurableObjectState;
    const env = { DB: {} } as never;
    const scheduler = new Scheduler(state, env);

    const response = await scheduler.fetch(new Request("https://scheduler.internal/arm", { method: "POST" }));
    await scheduler.alarm();

    expect(response.status).toBe(404);
    expect(setAlarm).not.toHaveBeenCalled();
  });
});
