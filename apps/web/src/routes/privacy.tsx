import { createFileRoute, Link } from "@tanstack/react-router";

// Open-core stub: the marketing /privacy page is cloud-only. Any self-hosted
// deployment still needs a /privacy route, so ship a minimal placeholder.
export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Privacy Policy — Leenar" }] }),
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        This is a self-hosted deployment of Leenar. Replace this page with your
        own privacy policy.
      </p>
      <Link
        to="/console"
        className="mt-8 inline-block text-sm underline hover:text-foreground"
      >
        Back to console
      </Link>
    </div>
  );
}
