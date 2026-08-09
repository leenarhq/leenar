import { createFileRoute, redirect } from "@tanstack/react-router";

// Open-core: the marketing landing is cloud-only. Root path redirects to the app.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/console" });
  },
});
