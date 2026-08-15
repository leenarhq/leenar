// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ImportReport } from "./ImportReport";

// Vitest globals are off here, so RTL's auto-cleanup never registers: without
// this every render stacks up in document.body and getByText starts matching
// leftovers from earlier cases.
afterEach(cleanup);

describe("ImportReport", () => {
  it("says the backend is already the user's", () => {
    render(
      <ImportReport
        builder={{
          name: "lovable",
          supabaseRef: "abcdefghijklmnopqrst",
          envStyle: "env-file",
          backendOwnership: "user",
          notMigrated: [],
        }}
      />,
    );
    expect(screen.getByText(/abcdefghijklmnopqrst/)).toBeTruthy();
    expect(screen.getByText(/your own Supabase project/i)).toBeTruthy();
  });

  it("lists what does not come across for an external backend", () => {
    render(
      <ImportReport
        builder={{
          name: "lovable",
          supabaseRef: "abcdefghijklmnopqrst",
          envStyle: "env-file",
          backendOwnership: "external",
          notMigrated: ["database rows", "auth users"],
        }}
      />,
    );
    expect(screen.getByText(/database rows/)).toBeTruthy();
    expect(screen.getByText(/auth users/)).toBeTruthy();
  });

  it("names the ref and points at connecting Supabase when ownership is unknown", () => {
    render(
      <ImportReport
        builder={{
          name: "lovable",
          supabaseRef: "abcdefghijklmnopqrst",
          envStyle: "env-file",
          backendOwnership: "unknown",
          notMigrated: [],
        }}
      />,
    );
    expect(screen.getByText(/abcdefghijklmnopqrst/)).toBeTruthy();
    expect(
      screen.getByText(/could not check whether it is yours/i),
    ).toBeTruthy();
    expect(screen.getByText(/Connect Supabase before approving/i)).toBeTruthy();
  });

  it("warns when the keys are hardcoded, because env injection will not take", () => {
    render(
      <ImportReport
        builder={{
          name: "lovable",
          supabaseRef: "abcdefghijklmnopqrst",
          envStyle: "hardcoded",
          backendOwnership: "user",
          notMigrated: [],
        }}
      />,
    );
    expect(screen.getByText(/hardcoded/i)).toBeTruthy();
  });
});
