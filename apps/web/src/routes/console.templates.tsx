import { createFileRoute } from "@tanstack/react-router";
import { ConsoleTopBar } from "./console";

// Core stub: workflow templates are not included in this build. The route is
// kept so links/nav still resolve.
export const Route = createFileRoute("/console/templates")({
  component: TemplatesPlaceholder,
  head: () => ({ meta: [{ title: "Templates" }] }),
});

function TemplatesPlaceholder() {
  return (
    <>
      <ConsoleTopBar title="Templates" />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm rounded-xl border border-dashed border-border bg-background/60 p-8 text-center">
          <h2 className="text-base font-semibold">Templates</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Prebuilt workflow templates are not available in this build.
          </p>
        </div>
      </div>
    </>
  );
}
