import { describe, it, expect } from "vitest";
import { NOUNS, statusLabel, statusTone } from "./labels";

describe("NOUNS", () => {
  it("exposes the three user-facing product nouns", () => {
    expect(NOUNS.project).toBe("Project");
    expect(NOUNS.service).toBe("Service");
    expect(NOUNS.connection).toBe("Connection");
  });
});

describe("statusLabel", () => {
  it("maps draft to Draft", () => {
    expect(statusLabel("draft")).toBe("Draft");
  });
  it("maps active to Live", () => {
    expect(statusLabel("active")).toBe("Live");
  });
  it("maps error to Needs attention", () => {
    expect(statusLabel("error")).toBe("Needs attention");
  });
  it("falls back to Draft for unknown/empty status", () => {
    expect(statusLabel("")).toBe("Draft");
    expect(statusLabel("something-else")).toBe("Draft");
  });
});

describe("statusTone", () => {
  it("maps active to positive, error to warning, draft to neutral", () => {
    expect(statusTone("active")).toBe("positive");
    expect(statusTone("error")).toBe("warning");
    expect(statusTone("draft")).toBe("neutral");
  });
});
