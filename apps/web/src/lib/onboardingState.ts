// ── Guided Setup (registry-driven) ────────────────────────────────

export const SAMPLE_PROJECT_NAME = "Sample: Full-Stack App";

/** The seeded demo project must never satisfy the "build" step. Given a raw
 *  project list, return the sample's id so callers can exclude/persist it. */
export function pickSampleProjectId(
  projects: { id: string; name: string }[],
): string | undefined {
  return projects.find((p) => p.name === SAMPLE_PROJECT_NAME)?.id;
}

export type SetupStepId = "connect" | "build" | "deploy";

export interface SetupSignals {
  connectedServices: string[];
  /** max node_count across the user's own (non-demo) projects */
  ownWorkflowMaxNodes: number;
  deployCount: number;
  onboardingComplete: boolean;
}

export interface SetupStepState {
  id: SetupStepId;
  title: string;
  oneLiner: string;
  cta: { label: string; href?: string };
  /** data-tour selector to spotlight when this step is active (if on-screen) */
  target?: string;
  gates: boolean;
  done: boolean;
}

export interface DerivedSetup {
  steps: SetupStepState[];
  activeStepId: SetupStepId | null;
  completedCount: number;
  totalSteps: number;
  progress: number;
  allDone: boolean;
  /** all gating steps done */
  coreDone: boolean;
  /** true while the soft-gate holds (some gating step incomplete) */
  gating: boolean;
  isFirstRun: boolean;
}

interface SetupStepDef {
  id: SetupStepId;
  title: string;
  oneLiner: string;
  cta: { label: string; href?: string };
  target?: string;
  gates: boolean;
  isDone: (s: SetupSignals) => boolean;
}

/** The onboarding is scalable by design: add a step here and the panel,
 *  progress math, spotlight and gate logic all pick it up. */
export const SETUP_STEPS: SetupStepDef[] = [
  {
    id: "connect",
    title: "Connect a provider",
    oneLiner: "Link GitHub or Vercel so Leenar can deploy on your behalf.",
    cta: { label: "Connect", href: "/console/integrations" },
    gates: true,
    isDone: (s) => s.connectedServices.length > 0,
  },
  {
    id: "build",
    title: "Build your first workflow",
    oneLiner:
      "Describe your app in the chat — Leenar drops the right services onto the canvas.",
    cta: { label: "New project", href: "/console/new" },
    target: "chat",
    gates: true,
    isDone: (s) => s.ownWorkflowMaxNodes >= 1,
  },
  {
    id: "deploy",
    title: "Deploy your stack",
    oneLiner: "One click provisions every service in the right order.",
    cta: { label: "Open a project", href: "/console" },
    target: "deploy-btn",
    gates: false,
    isDone: (s) => s.deployCount > 0,
  },
];

export function deriveSetup(signals: SetupSignals): DerivedSetup {
  const steps: SetupStepState[] = SETUP_STEPS.map((d) => ({
    id: d.id,
    title: d.title,
    oneLiner: d.oneLiner,
    cta: d.cta,
    target: d.target,
    gates: d.gates,
    done: d.isDone(signals),
  }));
  const completedCount = steps.filter((s) => s.done).length;
  const totalSteps = steps.length;
  const coreDone = steps.filter((s) => s.gates).every((s) => s.done);
  return {
    steps,
    activeStepId: steps.find((s) => !s.done)?.id ?? null,
    completedCount,
    totalSteps,
    progress: totalSteps ? completedCount / totalSteps : 0,
    allDone: completedCount === totalSteps,
    coreDone,
    gating: !coreDone,
    isFirstRun: !signals.onboardingComplete,
  };
}
