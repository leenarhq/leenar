import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ProjectContextBar } from "./console";

export const Route = createFileRoute("/console/projects/$id")({
  component: ProjectLayout,
  head: () => ({ meta: [{ title: "Project — Leenar Console" }] }),
});

function ProjectLayout() {
  const { id } = Route.useParams();
  return (
    <>
      <ProjectContextBar projectId={id} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </>
  );
}
