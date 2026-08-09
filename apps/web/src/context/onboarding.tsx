import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./auth";
import { getConnectedServices } from "../lib/api";
import { getProjects } from "../lib/workflows";
import { getSeededProjectId } from "../lib/onboarding";
import { deriveSetup, type DerivedSetup } from "../lib/onboardingState";

const dismissKey = (userId: string) => `leenar_checklist_dismissed_${userId}`;
const setupCollapsedKey = (userId: string) =>
  `leenar_setup_collapsed_${userId}`;

export interface OnboardingContextValue {
  ready: boolean;
  connectedServices: string[];
  workflowCount: number;
  deployCount: number;
  demoProjectId: string | null;
  dismissed: boolean;
  collapsed: boolean;
  setup: DerivedSetup;
  actions: {
    dismiss(): void;
    collapse(next: boolean): void;
    markOnboardingComplete(): void;
    refresh(): Promise<void>;
  };
}

const inert: OnboardingContextValue = {
  ready: false,
  connectedServices: [],
  workflowCount: 0,
  deployCount: 0,
  demoProjectId: null,
  dismissed: true,
  collapsed: false,
  setup: deriveSetup({
    connectedServices: [],
    ownWorkflowMaxNodes: 0,
    deployCount: 0,
    onboardingComplete: true,
  }),
  actions: {
    dismiss: () => {},
    collapse: () => {},
    markOnboardingComplete: () => {},
    refresh: async () => {},
  },
};

const OnboardingContext = createContext<OnboardingContextValue>(inert);

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const meta = session?.user?.user_metadata;

  const [ready, setReady] = useState(false);
  const [connectedServices, setConnectedServices] = useState<string[]>([]);
  const [projects, setProjects] = useState<
    { id: string; deploy_count: number; node_count: number }[]
  >([]);
  const [localDismissed, setLocalDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setLocalDismissed(
      !!userId &&
        typeof localStorage !== "undefined" &&
        localStorage.getItem(dismissKey(userId)) === "1",
    );
  }, [userId]);

  useEffect(() => {
    setCollapsed(
      !!userId &&
        typeof localStorage !== "undefined" &&
        localStorage.getItem(setupCollapsedKey(userId)) === "1",
    );
  }, [userId]);

  const demoProjectId =
    (userId ? getSeededProjectId(userId) : undefined) ??
    (meta?.demo_project_id as string | undefined) ??
    null;

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const [svcs, projs] = await Promise.all([
        getConnectedServices(session).catch(() => [] as string[]),
        getProjects().catch(() => []),
      ]);
      setConnectedServices(svcs);
      setProjects(
        projs.map((p) => ({
          id: p.id,
          deploy_count: p.deploy_count,
          node_count: p.node_count,
        })),
      );
    } finally {
      setReady(true);
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setReady(false);
      return;
    }
    void refresh();
  }, [session, refresh]);

  useEffect(() => {
    if (!session) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [session, refresh]);

  const setup = useMemo<DerivedSetup>(() => {
    const ownWorkflowMaxNodes = projects
      .filter((p) => p.id !== demoProjectId)
      .reduce((max, p) => Math.max(max, p.node_count), 0);
    const deployCount = projects.reduce((sum, p) => sum + p.deploy_count, 0);
    return deriveSetup({
      connectedServices,
      ownWorkflowMaxNodes,
      deployCount,
      onboardingComplete: !!meta?.onboarding_complete,
    });
  }, [projects, connectedServices, demoProjectId, meta?.onboarding_complete]);

  const dismiss = useCallback(() => {
    if (!setup.coreDone) return; // soft-gate: cannot dismiss until core steps done
    if (userId && typeof localStorage !== "undefined")
      localStorage.setItem(dismissKey(userId), "1");
    setLocalDismissed(true);
    supabase.auth
      .updateUser({ data: { checklist_dismissed: true } })
      .catch(() => {});
  }, [userId, setup.coreDone]);

  const collapse = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      if (userId && typeof localStorage !== "undefined")
        localStorage.setItem(setupCollapsedKey(userId), next ? "1" : "0");
    },
    [userId],
  );

  const markOnboardingComplete = useCallback(() => {
    if (userId && typeof localStorage !== "undefined")
      localStorage.setItem(dismissKey(userId), "1");
    setLocalDismissed(true);
    supabase.auth
      .updateUser({ data: { onboarding_complete: true } })
      .catch(() => {});
  }, [userId]);

  const value = useMemo<OnboardingContextValue>(() => {
    const workflowCount = projects.filter((p) => p.id !== demoProjectId).length;
    const deployCount = projects.reduce((sum, p) => sum + p.deploy_count, 0);
    const dismissed =
      localDismissed ||
      !!meta?.checklist_dismissed ||
      !!meta?.onboarding_complete;
    return {
      ready,
      connectedServices,
      workflowCount,
      deployCount,
      demoProjectId,
      dismissed,
      collapsed,
      setup,
      actions: { dismiss, collapse, markOnboardingComplete, refresh },
    };
  }, [
    projects,
    connectedServices,
    demoProjectId,
    meta?.onboarding_complete,
    meta?.checklist_dismissed,
    localDismissed,
    ready,
    collapsed,
    setup,
    dismiss,
    collapse,
    markOnboardingComplete,
    refresh,
  ]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
