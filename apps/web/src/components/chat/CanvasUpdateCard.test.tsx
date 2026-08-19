// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CanvasUpdateCard } from "./CanvasUpdateCard";
import type { CanvasUpdatePayload } from "../../lib/api";

// Vitest globals are off here, so RTL's auto-cleanup never registers.
afterEach(cleanup);

const UPDATE = {
  description: "Add a database",
  nodes: [{ type: "service", data: { label: "Supabase" } }],
  edges: [{ source: "a", target: "b" }],
} as unknown as CanvasUpdatePayload;

describe("CanvasUpdateCard", () => {
  it("is a receipt once the canvas has taken the update", () => {
    render(
      <CanvasUpdateCard
        update={UPDATE}
        onApply={() => {}}
        applied
        canApply={false}
      />,
    );

    expect(screen.getByText("Added to canvas")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a working button when this view owns a canvas", () => {
    const onApply = vi.fn();
    render(
      <CanvasUpdateCard
        update={UPDATE}
        onApply={onApply}
        applied={false}
        canApply
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add to canvas/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // The defect this state exists for: the mobile sheet renders ChatPanel with
  // no `onAddNodes`, so the old card drew an enabled button whose handler
  // returned on its first line — a click that did nothing and said nothing.
  it("offers no button at all when nothing here can apply the update", () => {
    render(
      <CanvasUpdateCard
        update={UPDATE}
        onApply={() => {
          throw new Error("must not be reachable");
        }}
        applied={false}
        canApply={false}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/no canvas/i)).toBeTruthy();
  });
});
