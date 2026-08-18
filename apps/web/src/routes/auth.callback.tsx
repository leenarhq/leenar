import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "../lib/supabase";
import { markRecovery, isRecovering } from "../lib/recovery";
import { LeenarMark } from "../components/auth-shell";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: AuthCallbackPage,
});

const TERMS_VERSION = "2026-06-01";

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const urlError = params.get("error");
    const urlErrorDesc = params.get("error_description");

    if (urlError) {
      const msg = urlErrorDesc
        ? decodeURIComponent(urlErrorDesc).replace(/\+/g, " ")
        : urlError === "access_denied"
          ? "Access was denied. Please try again."
          : `Authentication failed: ${urlError}`;
      setError(msg);
      return;
    }

    const recovering =
      isRecovering() || window.location.hash.includes("type=recovery");
    if (recovering) markRecovery();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        markRecovery();
        navigate({ to: "/reset-password", replace: true });
        return;
      }
      if (recovering) {
        navigate({ to: "/reset-password", replace: true });
        return;
      }
      if (event === "SIGNED_IN") {
        if (session?.user && !session.user.user_metadata?.terms_accepted_at) {
          supabase.auth
            .updateUser({
              data: {
                terms_accepted_at: new Date().toISOString(),
                terms_version: TERMS_VERSION,
              },
            })
            .catch(() => {});
        }
        navigate({ to: "/console", replace: true });
      }
      if (event === "USER_UPDATED") navigate({ to: "/console", replace: true });
    });

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setError(error.message);
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
          setError("This link is invalid or has expired.");
          return;
        }
        navigate({
          to: recovering ? "/reset-password" : "/console",
          replace: true,
        });
      });
    }

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-[376px] text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LeenarMark className="h-[15px] w-auto" />
          <span className="text-sm font-medium tracking-[-0.01em]">Leenar</span>
        </div>
        {error ? (
          <>
            <p className="text-[13.5px] text-crit">{error}</p>
            <button
              className="mt-4 font-mono text-[10px] lowercase text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => navigate({ to: "/login" })}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
