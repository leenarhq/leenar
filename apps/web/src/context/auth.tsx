import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { sendOnboardingEmail } from "../lib/api";
import { identifyUser, clearUser } from "../lib/monitoring";
import { ensureOnboarded } from "../lib/onboarding";
import { sameSession } from "../lib/sessionEquality";
import { markRecovery, isRecovering, clearRecovery } from "../lib/recovery";

// Module-level set: prevents extra API calls within the same tab session.
// The DB table (user_onboarding_sent) is the authoritative gatekeeper on the backend.
const firedForUser = new Set<string>();

function maybeFireOnboarding(session: Session | null) {
  if (!session) return;
  const { id, email, user_metadata } = session.user;
  if (firedForUser.has(id)) return;
  firedForUser.add(id);
  const name =
    (user_metadata?.full_name as string | undefined) ??
    email?.split("@")[0] ??
    "";
  sendOnboardingEmail(name, email ?? "", session).catch(() => {
    firedForUser.delete(id);
  });
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * True when the current session came from a password-reset link, not a real
   * login. Public-route guards must NOT redirect such a session into the app.
   */
  isRecovery: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  isRecovery: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Detect recovery synchronously on first render — before getSession resolves —
  // so a guard never sees the recovery session as a plain login and bounces it.
  const [isRecovery, setIsRecovery] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    if (isRecovering()) return true;
    if (window.location.hash.includes("type=recovery")) {
      markRecovery();
      return true;
    }
    return false;
  });

  useEffect(() => {
    // Only push a NEW session reference into state when the token/user actually
    // changed. Supabase re-emits the same session frequently; without this guard
    // every emit re-runs every `[session]` effect in the app, making the
    // dashboard look like it reloads every few seconds. See sessionEquality.ts.
    const applySession = (next: Session | null) =>
      setSession((prev) => (sameSession(prev, next) ? prev : next));

    // Supabase pauses its auto-refresh timer while the tab is hidden. When the
    // tab returns to the foreground, proactively call getSession() so it
    // resumes the refresh cycle instead of waiting on the (paused) timer.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void supabase.auth.getSession();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
      setLoading(false);
      maybeFireOnboarding(session);
      if (session) ensureOnboarded(session.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") {
        markRecovery();
        setIsRecovery(true);
      }
      if (event === "SIGNED_OUT") {
        clearRecovery();
        setIsRecovery(false);
      }
      if (event === "SIGNED_IN") {
        maybeFireOnboarding(session);
        if (session) {
          ensureOnboarded(session.user);
          identifyUser(session.user.id);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    clearUser();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isRecovery,
      signOut,
    }),
    [session, loading, isRecovery, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
