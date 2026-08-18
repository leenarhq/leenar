import { Children } from "react";
import type { ReactNode, HTMLAttributes } from "react";

/**
 * One background, a 1px gap, cells painted in the page colour — so the gap
 * shows through as a perfect hairline and no cell draws its own border.
 * Emphasis is a cell fill (`hot`), never a colour. Same mechanism as the
 * marketing Compare table.
 */
const COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
};

/**
 * A short last row would otherwise leave the container's own --border fill
 * showing as a pale block where cells are missing — the one failure mode this
 * mechanism has, and one marketing never hits because Compare's rows are
 * always full. Blank cells finish the row.
 *
 * The count differs per breakpoint (a 7-item grid needs two fillers at three
 * columns and one at two), so both are emitted and each is shown only where
 * it is needed. Class strings stay literal so Tailwind can see them.
 */
function fillers(count: number, wide: number): string[] {
  const need = (cols: number) => (cols - (count % cols)) % cols;
  // The 5-column ladder is two-up from the smallest breakpoint; every other
  // one starts single-column, where a row can never be short.
  const n2 = need(2);
  const nWide = need(wide);
  const base = wide === 5 ? "block" : "hidden";
  const out: string[] = [];
  for (let i = 0; i < Math.max(n2, nWide); i++) {
    const shownAtTwo = i < n2;
    const start = wide === 5 && shownAtTwo ? base : "hidden";
    const sm = shownAtTwo ? "sm:block" : "sm:hidden";
    const lg = i < nWide ? "lg:block" : "lg:hidden";
    out.push(`${start} ${sm} ${lg}`);
  }
  return out;
}

export function HairGrid({
  cols: n = 3,
  children,
}: {
  cols?: 2 | 3 | 4 | 5;
  children: ReactNode;
}) {
  // toArray, not count: `count` counts a `false` from a conditional child
  // (`{cf && <Cell/>}`) as a child, so a grid of three cells rendered from
  // four conditional slots computes zero fillers — and the container's own
  // --border fill shows through the empty slot as a pale block. toArray
  // drops null/undefined/booleans, which is the number actually rendered.
  const count = Children.toArray(children).length;
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className={`grid gap-px bg-border ${COLS[n]}`}>
        {children}
        {fillers(count, n).map((cls, i) => (
          <div
            key={`fill-${i}`}
            aria-hidden
            className={`bg-background ${cls}`}
          />
        ))}
      </div>
    </div>
  );
}

export function HairCell({
  hot = false,
  className = "",
  children,
  ...rest
}: { hot?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`p-5 transition-colors ${hot ? "bg-secondary" : "bg-background hover:bg-secondary"} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
