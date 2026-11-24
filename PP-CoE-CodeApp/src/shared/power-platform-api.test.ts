import { beforeEach, describe, expect, it, vi } from "vitest";
import { executePowerPlatformRequest } from "./power-platform-api";

const { runFlow } = vi.hoisted(() => ({ runFlow: vi.fn() }));
vi.mock("../generated/services/PP_API_Wrapper_FlowService", () => ({
  PP_API_Wrapper_FlowService: { Run: runFlow },
}));
beforeEach(() => vi.resetAllMocks());

describe("shared Power Platform API transport", () => {
  it("blocks unconfirmed writes and foreign hosts before invoking the flow", async () => {
    const request = { method: "POST", url: "https://api.powerplatform.com/copilotstudio/licensing/reports/example", body: "{}" };
    expect(await executePowerPlatformRequest(request)).toMatchObject({ ok: false, error: expect.stringContaining("confirm") });
    for (const url of ["https://graph.microsoft.com/v1.0/users", "https://api.powerplatform.com.evil.example/", "https://user@api.powerplatform.com/"]) {
      expect(await executePowerPlatformRequest({ ...request, url }, true)).toMatchObject({ ok: false, error: expect.stringContaining("host") });
    }
    expect(runFlow).not.toHaveBeenCalled();
  });
});
