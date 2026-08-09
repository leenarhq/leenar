import { describe, it, expect, vi } from "vitest";
import { authorizedFetch } from "./authorizedFetch";

function res(status: number) {
  return new Response(status === 200 ? "ok" : "no", { status });
}

describe("authorizedFetch", () => {
  it("attaches the fresh bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => res(200));
    await authorizedFetch(
      "/x",
      {},
      { getToken: async () => "tok-1", fetchImpl },
    );
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-1");
  });

  it("refreshes and retries once on 401, using a new token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200));
    const getToken = vi
      .fn()
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("fresh");
    const r = await authorizedFetch("/x", {}, { getToken, fetchImpl });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("does not retry more than once (returns the second 401)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(res(401));
    const r = await authorizedFetch(
      "/x",
      {},
      { getToken: async () => "t", fetchImpl },
    );
    expect(r.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
