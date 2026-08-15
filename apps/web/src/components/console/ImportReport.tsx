import type { BuilderInfo } from "../../lib/api";

const BUILDER_LABEL: Record<string, string> = { lovable: "Lovable" };

export function ImportReport({ builder }: { builder: BuilderInfo }) {
  const label = BUILDER_LABEL[builder.name] ?? builder.name;

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm">
      <div className="font-semibold text-foreground">
        {label} project detected
      </div>

      {builder.backendOwnership === "user" && builder.supabaseRef && (
        <p className="mt-2 text-muted-foreground">
          Backend: your own Supabase project{" "}
          <code className="text-foreground">{builder.supabaseRef}</code>. Leenar
          will connect it rather than create a new one.
        </p>
      )}

      {builder.backendOwnership === "external" && (
        <>
          <p className="mt-2 text-muted-foreground">
            This app talks to a backend outside your Supabase account, so Leenar
            will not create a database for it. Hosting moves over now; the data
            move is a separate step.
          </p>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {builder.notMigrated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {builder.backendOwnership === "unknown" && builder.supabaseRef && (
        <p className="mt-2 text-muted-foreground">
          This app talks to Supabase project{" "}
          <code className="text-foreground">{builder.supabaseRef}</code>, but we
          could not check whether it is yours — no Supabase account is
          connected. Connect Supabase before approving and Leenar will adopt
          that project instead of creating a new one.
        </p>
      )}

      {builder.envStyle === "hardcoded" && (
        <p className="mt-2 text-muted-foreground">
          The Supabase URL and key are hardcoded in the source, not read from
          the environment. Environment variables Leenar injects will have no
          effect until that changes.
        </p>
      )}
    </div>
  );
}
