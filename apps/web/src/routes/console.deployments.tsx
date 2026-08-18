import { createFileRoute } from "@tanstack/react-router";
import { ConsoleTopBar } from "./console";

export const Route = createFileRoute("/console/deployments")({
  component: DeploymentsRedirect,
  head: () => ({ meta: [{ title: "Deployments — Leenar Console" }] }),
});

function DeploymentsRedirect() {
  return (
    <>
      <ConsoleTopBar title="Deployments" />
      {/* Still a placeholder, deliberately. The design asks this route to show
          the project view "without the project filter", but listDeployments needs
          a project id and no cross-project endpoint exists — building one is
          a feature, not a skin change. */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-[13px]">Deployments live inside each project</p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Open a project to see its history. An all-projects rollup needs a
            cross-project endpoint that does not exist yet.
          </p>
        </div>
      </div>
    </>
  );
}
