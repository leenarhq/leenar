import { supabase } from "./supabase";
import type { ReactFlowJsonObject } from "@xyflow/react";

// ── Types ────────────────────────────────────────────────────

export type ProjectStatus = "draft" | "active" | "error";
export type DeploymentStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  status: ProjectStatus;
  canvas: ReactFlowJsonObject;
  canvas_version: number;
  created_at: string;
  updated_at: string;
}

/** Lightweight shape returned by project_summary view — no canvas payload */
export interface ProjectSummary {
  id: string;
  user_id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  node_count: number;
  edge_count: number;
  deploy_count: number;
  last_deployed_at: string | null;
  last_deploy_status: DeploymentStatus | null;
  last_deployment_id: string | null;
}

export interface Chat {
  id: string;
  user_id: string;
  name: string;
  chat_history: StoredChatMessage[];
  created_at: string;
  updated_at: string;
}

// ── Projects ──────────────────────────────────────────────────

/** List canvas projects for the authenticated user. */
export async function getProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from("project_summary")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data as ProjectSummary[];
}

/** List recent AI chat conversations for the sidebar. */
export async function getChats(): Promise<Chat[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("id, user_id, name, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) throw error;
  return data as Chat[];
}

/** Load a single project with its full canvas. */
export async function getProject(id: string): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Project;
}

/** Create a new canvas project and return it. */
export async function createProject(
  name = "New Project",
  canvas?: ReactFlowJsonObject,
): Promise<Project> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name,
      ...(canvas ? { canvas } : {}),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Project;
}

/** Create a new AI chat conversation and return it. */
export async function createChatConversation(
  name = "New conversation",
): Promise<Chat> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("chats")
    .insert({ user_id: user.id, name })
    .select("*")
    .single();

  if (error) throw error;
  return data as Chat;
}

const CANVAS_MAX_BYTES = 256_000;
const CANVAS_MAX_NODES = 50;
const CANVAS_MAX_EDGES = 200;

function validateCanvas(canvas: ReactFlowJsonObject): void {
  if (JSON.stringify(canvas).length > CANVAS_MAX_BYTES)
    throw new Error(
      "Canvas is too large (max 256 KB). Remove some nodes or edge data.",
    );
  if ((canvas.nodes?.length ?? 0) > CANVAS_MAX_NODES)
    throw new Error(`Too many nodes (max ${CANVAS_MAX_NODES}).`);
  if ((canvas.edges?.length ?? 0) > CANVAS_MAX_EDGES)
    throw new Error(`Too many edges (max ${CANVAS_MAX_EDGES}).`);
}

/** Persist the current canvas state (called by the auto-save debounce). */
export async function saveCanvas(
  projectId: string,
  canvas: ReactFlowJsonObject,
  currentStatus?: ProjectStatus,
): Promise<void> {
  validateCanvas(canvas);
  const isEmpty = !canvas.nodes || canvas.nodes.length === 0;
  const patch: Record<string, unknown> = { canvas };
  if (isEmpty && currentStatus === "active") patch.status = "draft";

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", projectId);

  if (error) throw error;
}

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
  // ChatPanel.tsx (canvas AI chat) — reconstructs ParsedMessage on load
  canvasUpdate?: unknown;
  pendingUpdate?: unknown;
  autoApplied?: boolean;
  // console.new.tsx (new-project chat) — embedded on the assistant message
  // that introduced the proposal, so proposalMsgIdx/proposalSplitAt can be
  // re-derived from this message's position at load time instead of
  // persisting raw (reload-fragile) array indices.
  proposal?: unknown;
  proposalHidesMessage?: boolean;
};

/** Persist the AI Architect chat history for a chat (last 50 messages). */
export async function saveChatHistory(
  chatId: string,
  messages: StoredChatMessage[],
): Promise<void> {
  const trimmed = messages.slice(-50);
  const { error } = await supabase
    .from("chats")
    .update({ chat_history: trimmed })
    .eq("id", chatId);

  if (error) throw error;
}

/** Load the AI Architect chat history for a chat. */
export async function loadChatHistory(
  chatId: string,
): Promise<StoredChatMessage[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("chat_history")
    .eq("id", chatId)
    .single();

  if (error) return [];
  return (data?.chat_history as StoredChatMessage[]) ?? [];
}

/** Rename a project. */
export async function renameProject(
  projectId: string,
  name: string,
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ name })
    .eq("id", projectId);

  if (error) throw error;
}

/** Rename a chat. */
export async function renameChat(chatId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("chats")
    .update({ name })
    .eq("id", chatId);

  if (error) throw error;
}

/** Delete a project (cascades to deployments + logs). */
export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) throw error;
}

/** Delete a chat. */
export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from("chats").delete().eq("id", chatId);

  if (error) throw error;
}

/** Duplicate a project — creates a new draft with the same canvas. */
export async function duplicateProject(id: string): Promise<Project> {
  const source = await getProject(id);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const canvas = source.canvas as any;
  const cleanCanvas = canvas
    ? {
        ...canvas,
        nodes: (canvas.nodes ?? []).map((n: any) => ({
          ...n,
          data: {
            ...n.data,
            status: "draft",
            vercelProjectId: undefined,
            supabaseProjectRef: undefined,
            provisionedUrl: undefined,
            errorMsg: undefined,
          },
        })),
      }
    : canvas;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: `${source.name} (Copy)`,
      canvas: cleanCanvas,
      status: "draft",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Project;
}

/** Import a project from a JSON canvas object — creates a new draft. */
export async function importProject(
  name: string,
  canvas: ReactFlowJsonObject,
): Promise<Project> {
  validateCanvas(canvas);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: user.id, name, canvas, status: "draft" })
    .select("*")
    .single();

  if (error) throw error;
  return data as Project;
}

/** Update a project's status. */
export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);

  if (error) throw error;
}

// ── Provisioning sessions ─────────────────────────────────────

export interface ProvisioningStep {
  name: string;
  nodeId?: string;
  status: "pending" | "running" | "success" | "error";
  started_at?: string;
  finished_at?: string;
  error?: string;
  output?: Record<string, string>;
}

export interface ProvisioningSession {
  id: string;
  stack_id: string;
  status: "running" | "success" | "failed" | "cancelled";
  steps: ProvisioningStep[];
  current_step: number;
  total_steps: number;
  error_message: string | null;
  finished_at: string | null;
}

export function subscribeToProvisioningSession(
  sessionId: string,
  onChange: (session: ProvisioningSession) => void,
  onStatus?: (status: "connected" | "dropped") => void,
): () => void {
  const channel = supabase
    .channel(`provision:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "provisioning_sessions",
        filter: `id=eq.${sessionId}`,
      },
      (payload) => onChange(payload.new as ProvisioningSession),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("connected");
      else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      )
        onStatus?.("dropped");
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
