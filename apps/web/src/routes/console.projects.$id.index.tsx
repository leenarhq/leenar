import { createFileRoute, redirect } from "@tanstack/react-router";

// Canvas is the project home. Any entry into a project (project-list click,
// bare /$id URL, rail home) lands on the canvas. The Overview/Manage dashboard
// now lives at /console/projects/$id/overview.
export const Route = createFileRoute("/console/projects/$id/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/console/projects/$id/canvas",
      params: { id: params.id },
    });
  },
});
