import { describe, it, expect } from "vitest";
import {
  deriveSetup,
  SETUP_STEPS,
  SAMPLE_PROJECT_NAME,
  pickSampleProjectId,
  type SetupSignals,
} from "./onboardingState";

const sig = (over: Partial<SetupSignals> = {}): SetupSignals => ({
  connectedServices: [],
  ownWorkflowMaxNodes: 0,
  deployCount: 0,
  onboardingComplete: false,
  ...over,
});

describe("deriveSetup", () => {
  it("brand-new user: nothing done, gating, active = connect", () => {
    const r = deriveSetup(sig());
    expect(r.completedCount).toBe(0);
    expect(r.totalSteps).toBe(3);
    expect(r.progress).toBeCloseTo(0);
    expect(r.gating).toBe(true);
    expect(r.coreDone).toBe(false);
    expect(r.activeStepId).toBe("connect");
    expect(r.isFirstRun).toBe(true);
  });

  it("connected only: active = build, still gating", () => {
    const r = deriveSetup(sig({ connectedServices: ["github"] }));
    expect(r.steps.find((s) => s.id === "connect")?.done).toBe(true);
    expect(r.activeStepId).toBe("build");
    expect(r.gating).toBe(true);
  });

  it("build threshold: 0 nodes not done, 1 node done", () => {
    expect(
      deriveSetup(sig({ ownWorkflowMaxNodes: 0 })).steps.find(
        (s) => s.id === "build",
      )?.done,
    ).toBe(false);
    expect(
      deriveSetup(sig({ ownWorkflowMaxNodes: 1 })).steps.find(
        (s) => s.id === "build",
      )?.done,
    ).toBe(true);
  });

  it("connect + build done: coreDone, not gating, active = deploy", () => {
    const r = deriveSetup(
      sig({ connectedServices: ["github"], ownWorkflowMaxNodes: 2 }),
    );
    expect(r.coreDone).toBe(true);
    expect(r.gating).toBe(false);
    expect(r.activeStepId).toBe("deploy");
    expect(r.allDone).toBe(false);
  });

  it("all done: allDone true, no active step, progress 1", () => {
    const r = deriveSetup(
      sig({
        connectedServices: ["github"],
        ownWorkflowMaxNodes: 1,
        deployCount: 1,
        onboardingComplete: true,
      }),
    );
    expect(r.allDone).toBe(true);
    expect(r.progress).toBe(1);
    expect(r.activeStepId).toBe(null);
    expect(r.isFirstRun).toBe(false);
  });

  it("deploy step does not gate", () => {
    expect(SETUP_STEPS.find((s) => s.id === "deploy")?.gates).toBe(false);
  });
});

describe("pickSampleProjectId", () => {
  it("finds the sample project by name", () => {
    expect(
      pickSampleProjectId([
        { id: "a", name: "My App" },
        { id: "b", name: SAMPLE_PROJECT_NAME },
      ]),
    ).toBe("b");
  });
  it("returns undefined when no sample present", () => {
    expect(pickSampleProjectId([{ id: "a", name: "My App" }])).toBeUndefined();
  });
});
