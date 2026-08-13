import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

// Thin wrapper around the shadcn Sheet primitive, purpose-built for mobile
// navigation panels (console sidebar today; reusable for other left-side
// mobile panels later — e.g. settings/logs side-nav if they ever need one).
export function MobileDrawer({
  open,
  onOpenChange,
  children,
  side = "left",
  title = "Navigation",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  side?: "left" | "right";
  title?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className="flex w-72 flex-col gap-0 p-0 sm:max-w-xs"
      >
        {/* Radix Dialog requires an accessible title; the drawer's own header
            (rendered by the caller) carries the visible title, so this one is
            visually hidden but still announced to screen readers. */}
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
