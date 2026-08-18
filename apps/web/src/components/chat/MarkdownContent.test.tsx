// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent";

// Vitest globals are off here, so RTL's auto-cleanup never registers.
afterEach(cleanup);

// Rendered outside `.app-shell` — which is where DashboardAgent renders it,
// and where `text-white` means literal #ffffff in BOTH themes. The class is
// the assertion because the colour it resolves to depends on a stylesheet
// jsdom does not load.
const LITERAL_INK = /\b(?:text|bg|border|placeholder)-(?:white|black)\b/;
const PALETTE =
  /\b(?:text|bg|border)-(?:blue|indigo|emerald|green|amber|red|purple|orange)-\d{2,3}\b/;

function classesOf(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>("*")]
    .map((el) => el.className)
    .join(" ");
}

describe("MarkdownContent", () => {
  it("renders headings, bold, code, bullets and numbers with no literal ink", () => {
    const { container } = render(
      <MarkdownContent
        text={[
          "# Heading one",
          "## Heading two",
          "### Heading three",
          "Some **bold** and *italic* and `code`.",
          "- first bullet",
          "1. first number",
        ].join("\n")}
      />,
    );

    const cls = classesOf(container);
    expect(cls).not.toMatch(LITERAL_INK);
    expect(cls).not.toMatch(PALETTE);
  });

  it("still renders the content it is given", () => {
    render(<MarkdownContent text={"# Title\n- point\n`snippet`"} />);
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("point")).toBeTruthy();
    expect(screen.getByText("snippet")).toBeTruthy();
  });

  it("keeps the app-accent variable out of the bullet glyph", () => {
    const { container } = render(<MarkdownContent text="- a bullet" />);
    expect(container.innerHTML).not.toContain("--app-accent");
  });
});
