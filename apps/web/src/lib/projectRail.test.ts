import { describe, it, expect } from "vitest";
import { projectRailItems, isRailItemActive } from "./projectRail";

describe("projectRailItems", () => {
  it("omits Overview when the project is not live", () => {
    expect(projectRailItems(false).map((i) => i.key)).toEqual([
      "canvas",
      "database",
      "deployments",
      "observability",
      "logs",
    ]);
  });

  it("inserts Overview in the third slot when the project is live", () => {
    expect(projectRailItems(true).map((i) => i.key)).toEqual([
      "canvas",
      "database",
      "overview",
      "deployments",
      "observability",
      "logs",
    ]);
  });
});

describe("isRailItemActive", () => {
  it("matches the canvas route", () => {
    expect(
      isRailItemActive("/console/projects/abc/canvas", "abc", "canvas"),
    ).toBe(true);
  });

  it("matches the database route", () => {
    expect(
      isRailItemActive("/console/projects/abc/database", "abc", "database"),
    ).toBe(true);
  });

  it("matches the overview route", () => {
    expect(
      isRailItemActive("/console/projects/abc/overview", "abc", "overview"),
    ).toBe(true);
  });

  it("does not confuse observability (/logs) with service logs (/service-logs)", () => {
    expect(
      isRailItemActive(
        "/console/projects/abc/service-logs",
        "abc",
        "observability",
      ),
    ).toBe(false);
    expect(
      isRailItemActive("/console/projects/abc/service-logs", "abc", "logs"),
    ).toBe(true);
  });

  it("matches observability on the /logs route", () => {
    expect(
      isRailItemActive("/console/projects/abc/logs", "abc", "observability"),
    ).toBe(true);
  });

  it("scopes matches to the given project id", () => {
    expect(
      isRailItemActive("/console/projects/xyz/canvas", "abc", "canvas"),
    ).toBe(false);
  });
});
