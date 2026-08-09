import type { User } from "@supabase/supabase-js";
import type { ReactFlowJsonObject } from "@xyflow/react";
import { supabase } from "./supabase";
import { buildTemplateCanvas } from "../components/canvas/workspaceTemplates";
import { importProject, getProjects } from "./workflows";
import { SAMPLE_PROJECT_NAME, pickSampleProjectId } from "./onboardingState";

const seededForUser = new Set<string>();
const seededProjectId = new Map<string, string>(); // userId → projectId

export function getSeededProjectId(userId: string): string | undefined {
  return seededProjectId.get(userId);
}

export async function ensureOnboarded(user: User) {
  if (user.user_metadata?.onboarding_seeded) return;
  if (seededForUser.has(user.id)) return;
  seededForUser.add(user.id);
  try {
    const canvas = buildTemplateCanvas("Full-Stack App");
    if (!canvas) return;
    const demo = await importProject(
      SAMPLE_PROJECT_NAME,
      canvas as ReactFlowJsonObject,
    );
    seededProjectId.set(user.id, demo.id);
    await supabase.auth.updateUser({
      data: { onboarding_seeded: true, demo_project_id: demo.id },
    });
  } catch (err) {
    // A concurrent call (second tab, reload mid-seed) may have already
    // created the sample project — projects_one_sample_per_user (migration
    // 058) rejects the duplicate insert with a unique violation. Treat that
    // as "already seeded" instead of retrying and creating a second one.
    if (isUniqueViolation(err)) {
      // A concurrent seed already created the sample. Recover its id so the
      // sample is reliably excluded from "build" detection and never
      // miscounts as the user's first real workflow.
      const existing = pickSampleProjectId(await getProjects().catch(() => []));
      if (existing) seededProjectId.set(user.id, existing);
      await supabase.auth.updateUser({
        data: { onboarding_seeded: true, demo_project_id: existing },
      });
      return;
    }
    seededForUser.delete(user.id);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
