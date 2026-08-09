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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select a project to view its deployments.
        </p>
      </div>
    </>
  );
}
