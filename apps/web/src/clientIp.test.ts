import { describe, it, expect } from "vitest";
import { clientIp } from "./clientIp";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("returns CF-Connecting-IP when present", () => {
    expect(clientIp(h({ "CF-Connecting-IP": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });
  it("returns 'unknown' when CF-Connecting-IP is absent — never trusts X-Forwarded-For", () => {
    expect(clientIp(h({ "X-Forwarded-For": "1.2.3.4" }))).toBe("unknown");
  });
  it("ignores X-Forwarded-For even when both are present", () => {
    expect(
      clientIp(
        h({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4" }),
      ),
    ).toBe("203.0.113.7");
  });
});
