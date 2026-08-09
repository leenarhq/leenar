import type { Session } from "@supabase/supabase-js";
import type { Node, Edge } from "@xyflow/react";
import { authorizedFetch } from "./authorizedFetch";
import type {
  LiveSchema,
  QueryResult,
  RowsPage,
  SchemaMutation,
  TableDef,
  ExtensionInfo,
  Snippet,
} from "./databaseTypes";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ServiceItem {
  service_type: "github" | "vercel" | "supabase" | "resend";
  display_name: string;
  existing_repo?: string | null;
}

export interface ConnectionItem {
  from_type: string;
  to_type: string;
  env_var_name: string;
}

export interface StackProposal {
  name: string;
  summary: string;
  services: ServiceItem[];
  connections: ConnectionItem[];
}

export interface CanvasUpdateNode {
  type: string;
  data: Record<string, unknown>;
}

export interface CanvasUpdatePayload {
  nodes: CanvasUpdateNode[];
  // edges: source/target can be a 0-based index into nodes[] (new node) OR an existing node ID string
  edges: Array<{ source: number | string; target: number | string }>;
  // update existing nodes by ID
  update?: Array<{ id: string; data: Record<string, unknown> }>;
  // remove existing nodes by ID
  remove?: string[];
  // remove edges between existing nodes by source+target node IDs
  disconnect?: Array<{ from: string; to: string }>;
  description?: string;
}

export interface ChatResponse {
  reply: string;
  proposal?: StackProposal;
  canvasUpdate?: CanvasUpdatePayload;
  pending?: CanvasUpdatePayload;
  action?: { type: "deploy" } | { type: "apply_template"; template: string };
  error?: string;
  quotaExceeded?: boolean;
}

export interface AIUsageInfo {
  messages: number;
  limit: number;
  remaining: number;
  estCostMicros: number;
}

async function apiFetch(
  path: string,
  _session: Session,
  options?: RequestInit,
) {
  const res = await authorizedFetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as any).error ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

export async function sendChat(
  messages: ChatMessage[],
  session: Session,
  mode: "stack" | "new" = "stack",
  projectId?: string,
): Promise<ChatResponse> {
  const res = await authorizedFetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, mode, projectId }),
  });
  const data = (await res.json()) as ChatResponse;
  // Quota exceeded is not an application error — return it as a structured response
  if (res.status === 429 && data.quotaExceeded) return data;
  if (!res.ok) {
    const msg = data.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export interface DashboardAgentResponse {
  reply: string;
  actionsTaken: { tool: string; summary: string }[];
  pending?: { id: string; summary: string };
  error?: string;
  quotaExceeded?: boolean;
}

// Multi-step DevOps agent for the dashboard chat. Unlike sendChat, the agent
// executes read-only tools itself and returns a stored, opaque `pending` id for
// any destructive action, which the UI approves via confirmAgentAction.
export async function sendDashboardAgent(
  messages: ChatMessage[],
  session: Session,
  projectId?: string,
): Promise<DashboardAgentResponse> {
  const res = await authorizedFetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, mode: "dashboard", projectId }),
  });
  const data = (await res.json()) as DashboardAgentResponse;
  if (res.status === 429 && data.quotaExceeded) return data;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function confirmAgentAction(
  pendingId: string,
  session: Session,
): Promise<{ ok: boolean; message: string }> {
  const res = await apiFetch("/api/agent/confirm", session, {
    method: "POST",
    body: JSON.stringify({ pending_id: pendingId }),
  });
  return res.json();
}

export interface CanvasAgentResponse {
  reply: string;
  actionsTaken?: { tool: string; summary: string }[];
  canvasUpdate?: CanvasUpdatePayload;
  canvasPending?: CanvasUpdatePayload;
  error?: string;
  quotaExceeded?: boolean;
}

// Canvas-editing agent for the workspace chat. Sends the current ReactFlow
// snapshot; the agent mutates an in-memory copy and returns a diff the client
// applies optimistically (its own autosave then persists to the active env).
export async function sendCanvasAgent(
  messages: ChatMessage[],
  session: Session,
  opts: { projectId?: string; canvas: { nodes: unknown[]; edges: unknown[] } },
): Promise<CanvasAgentResponse> {
  const res = await authorizedFetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      mode: "canvas",
      projectId: opts.projectId,
      canvas: opts.canvas,
    }),
  });
  const data = (await res.json()) as CanvasAgentResponse;
  if (res.status === 429 && data.quotaExceeded) return data;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function getMyAiUsage(session: Session): Promise<AIUsageInfo> {
  const res = await apiFetch("/api/chat/usage", session);
  return res.json();
}

export async function createStack(
  proposal: StackProposal,
  session: Session,
): Promise<{ id: string }> {
  const res = await apiFetch("/api/stacks", session, {
    method: "POST",
    body: JSON.stringify({
      name: proposal.name,
      requirements: {
        summary: proposal.summary,
        services: proposal.services,
        connections: proposal.connections,
      },
    }),
  });
  return res.json();
}

export async function getStack(
  stackId: string,
  session: Session,
): Promise<StackRecord> {
  const res = await apiFetch(`/api/stacks/${stackId}`, session);
  return res.json();
}

export async function startProvision(
  stackId: string,
  proposal: StackProposal,
  session: Session,
): Promise<void> {
  // Convert proposal format to what the Provisioner DO expects
  const approvedStack = {
    projectName: proposal.name,
    steps: proposal.services.map((svc) => ({
      service: svc.service_type,
      action: "provision",
      params: svc.existing_repo ? { existing_repo: svc.existing_repo } : {},
    })),
  };
  await apiFetch(`/api/provision/${stackId}`, session, {
    method: "POST",
    body: JSON.stringify({ approvedStack }),
  });
}

export interface StackRecord {
  id: string;
  name: string;
  status: "draft" | "provisioning" | "ready" | "error";
  requirements: {
    summary: string;
    services: ServiceItem[];
    connections: ConnectionItem[];
  } | null;
  created_at: string;
}

export interface ConnectionHealth {
  status: "valid" | "expired" | "invalid";
  checkedAt: string;
  incidentsReady?: boolean;
  account?: string;
  accountDetail?: string;
}

export type ConnectionHealthMap = Record<string, ConnectionHealth>;

export async function checkConnectionHealth(
  session: Session,
): Promise<ConnectionHealthMap> {
  const res = await apiFetch("/api/connections/health", session);
  return res.json();
}

export async function checkVercelGitHub(session: Session): Promise<{
  linked: boolean;
  vercelHasGitHub: boolean;
  githubHasVercel: boolean;
}> {
  const res = await apiFetch("/api/connections/vercel-github", session);
  return res.json();
}

export async function getConnectedServices(
  session: Session,
): Promise<string[]> {
  const res = await apiFetch("/api/oauth/connections", session);
  const rows = (await res.json()) as Array<{ service: string }>;
  return rows.map((r) => r.service);
}

export interface ProvisionResult {
  stackId: string;
  sessionId: string;
}

export interface DeprovisionNodeParams {
  service: string;
  stackId?: string;
  imported?: boolean;
  keepResource?: boolean;
  serviceIds: {
    vercelProjectId?: string;
    supabaseProjectRef?: string;
    githubRepoName?: string;
    cfWorkerName?: string;
    cfBucketName?: string;
    cloudflareAccountId?: string;
  };
}

export async function deprovisionNode(
  projectId: string,
  nodeId: string,
  params: DeprovisionNodeParams,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/nodes/${nodeId}`, session, {
    method: "DELETE",
    body: JSON.stringify(params),
  });
}

export async function removeNodeFromCanvases(
  projectId: string,
  nodeId: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/nodes/${nodeId}/canvas`, session, {
    method: "DELETE",
  });
}

export async function deleteEdgeEnvVars(
  projectId: string,
  vercelProjectId: string,
  envVars: string[],
  session: Session,
): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/edges/env-vars`, session, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vercelProjectId, envVars }),
  });
}

export async function getProvisionSession(
  projectId: string,
  sessionId: string,
  session: Session,
): Promise<Record<string, unknown>> {
  const res = await apiFetch(
    `/api/projects/${projectId}/session/${sessionId}`,
    session,
  );
  return res.json();
}

export async function getActiveDeploymentSession(
  projectId: string,
  session: Session,
): Promise<{ stackId: string; sessionId: string } | null> {
  const res = await apiFetch(
    `/api/projects/${projectId}/active-session`,
    session,
  );
  return res.json();
}

export async function provisionWorkflow(
  projectId: string,
  canvas: unknown,
  session: Session,
  projectName?: string,
  environmentId?: string | null,
  opts?: { nodeIds?: string[] },
): Promise<ProvisionResult> {
  const res = await apiFetch(`/api/projects/${projectId}/provision`, session, {
    method: "POST",
    body: JSON.stringify({
      canvas,
      projectName,
      environmentId,
      ...(opts?.nodeIds?.length ? { nodeIds: opts.nodeIds } : {}),
    }),
  });
  return res.json();
}

export async function sendOnboardingEmail(
  name: string,
  email: string,
  session: Session,
): Promise<void> {
  await apiFetch("/api/hooks/onboarding", session, {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
}

export async function importNode(
  projectId: string,
  service: "vercel" | "supabase" | "github",
  identifier: string,
  envId: string | undefined,
  session: Session,
): Promise<{
  node: Node;
  edges: Edge[];
  envId: string;
  canvas_version: number;
}> {
  const res = await apiFetch(
    `/api/projects/${projectId}/import-node`,
    session,
    {
      method: "POST",
      body: JSON.stringify({
        service,
        identifier,
        ...(envId ? { envId } : {}),
      }),
    },
  );
  return res.json();
}

export interface RepoProposal {
  proposal: {
    name: string;
    summary: string;
    services: Array<{
      service_type: string;
      display_name: string;
      existing_repo: string | null;
    }>;
    connections: Array<{ from_type: string; to_type: string }>;
  };
  repoFullName: string;
  detected_env_vars?: string[];
}

export async function analyzeRepoForStack(
  repoUrl: string,
  session: Session,
): Promise<RepoProposal> {
  const res = await apiFetch("/api/projects/from-repo", session, {
    method: "POST",
    body: JSON.stringify({ repoUrl }),
  });
  return res.json() as Promise<RepoProposal>;
}

export async function diagnoseProvisionError(
  error: string,
  services: string[],
  stackName: string,
  session: Session,
): Promise<string> {
  const res = await apiFetch("/api/projects/diagnose", session, {
    method: "POST",
    body: JSON.stringify({ error, services, stackName }),
  });
  const data = (await res.json()) as { suggestion: string };
  return data.suggestion;
}

export interface DiagnoseIncidentResult {
  cause: string;
  fix: string;
  suggestedAction?: {
    type:
      | "acknowledge_incident"
      | "resolve_incident"
      | "reconcile_drift"
      | "reprovision_resource"
      | "rollback";
    targetId?: string;
    label: string;
  };
}

export async function diagnoseIncident(
  incident: {
    id: string;
    service?: string | null;
    severity?: string | null;
    status_code?: number | null;
    path?: string | null;
    log_snippet?: string | null;
    count?: number | null;
  },
  session: Session,
): Promise<DiagnoseIncidentResult> {
  const res = await apiFetch("/api/incidents/diagnose", session, {
    method: "POST",
    body: JSON.stringify({
      incidentId: incident.id,
      service: incident.service ?? undefined,
      severity: incident.severity ?? undefined,
      statusCode: incident.status_code ?? undefined,
      path: incident.path ?? undefined,
      logSnippet: incident.log_snippet ?? undefined,
      count: incident.count ?? undefined,
    }),
  });
  return res.json() as Promise<DiagnoseIncidentResult>;
}

export interface ResendDomain {
  id: string;
  name: string;
  status:
    | "not_started"
    | "pending"
    | "verified"
    | "temporary_failure"
    | "permanent_failure";
  records?: Array<{
    type: string;
    name: string;
    value: string;
    ttl?: string;
    priority?: number;
  }>;
  region: string;
  created_at: string;
}

export interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

export async function getResendDomains(
  session: Session,
): Promise<ResendDomain[]> {
  const res = await apiFetch("/api/resend/domains", session);
  return res.json();
}

export async function createResendDomain(
  name: string,
  session: Session,
): Promise<ResendDomain> {
  const res = await apiFetch("/api/resend/domains", session, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function getResendDomainRecords(
  domainId: string,
  session: Session,
): Promise<ResendDomainRecord[]> {
  const res = await apiFetch(
    `/api/resend/domains/${domainId}/records`,
    session,
  );
  return res.json();
}

export async function deleteResendDomain(
  domainId: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/resend/domains/${domainId}`, session, {
    method: "DELETE",
  });
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  updated_at: string;
}

export async function getGitHubRepos(session: Session): Promise<GitHubRepo[]> {
  const res = await apiFetch("/api/github/repos", session);
  return res.json();
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export async function listGitHubBranches(
  repo: string,
  session: Session,
): Promise<GitHubBranch[]> {
  const res = await apiFetch(
    `/api/github/branches?repo=${encodeURIComponent(repo)}`,
    session,
  );
  return res.json();
}

export async function cancelDeployment(
  stackId: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/provision/${stackId}`, session, { method: "DELETE" });
}

export interface DeploymentSummary {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  provider_refs: Record<
    string,
    {
      service: string;
      projectId?: string;
      deploymentId?: string;
      workerName?: string;
      versionId?: string;
    }
  >;
}

export async function listDeployments(
  projectId: string,
  session: Session | null,
): Promise<DeploymentSummary[]> {
  if (!session) return [];
  const res = await apiFetch(`/api/projects/${projectId}/deployments`, session);
  const data = (await res.json()) as { deployments?: DeploymentSummary[] };
  return Array.isArray(data.deployments) ? data.deployments : [];
}

export type NodeRevertResult = {
  nodeId: string;
  service: string;
  action: "reverted" | "canvas_only" | "failed" | "not_supported";
  detail?: string;
};

export async function rollbackDeployment(
  projectId: string,
  deploymentId: string,
  session: Session | null,
): Promise<{
  ok: boolean;
  canvasRestored: boolean;
  results: NodeRevertResult[];
  warnings?: string[];
}> {
  if (!session) throw new Error("Not authenticated");
  const res = await apiFetch(
    `/api/projects/${projectId}/deployments/${deploymentId}/rollback`,
    session,
    {
      method: "POST",
      headers: { "X-Confirm-Rollback": "true" },
    },
  );
  return res.json();
}

export async function startOAuthFlow(
  svc: string,
  session: Session,
  returnTo: string,
): Promise<string> {
  const res = await apiFetch(`/api/oauth/${svc}/start`, session, {
    method: "POST",
    body: JSON.stringify({ returnTo }),
  });
  const data = (await res.json()) as { url: string };
  return data.url;
}

/** Connect a token-based service (vercel, resend, cloudflare) by pasting a token. */
export async function connectServiceToken(
  svc: string,
  token: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/oauth/${svc}/token`, session, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** Disconnect any connected service. */
export async function disconnectService(
  svc: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/oauth/${svc}`, session, { method: "DELETE" });
}

export async function deleteProjectWithResources(
  projectId: string,
  session: Session,
  keepResources?: boolean,
): Promise<{ ok: boolean; warnings?: string[] }> {
  const qs = keepResources ? "?keepResources=true" : "";
  const res = await apiFetch(`/api/projects/${projectId}${qs}`, session, {
    method: "DELETE",
    headers: { "X-Confirm-Delete": "true" },
  });
  return res.json();
}

export async function getEnvCanvas(
  projectId: string,
  envId: string,
  session: Session,
): Promise<{
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
  canvas_version?: number;
}> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${envId}/canvas`,
    session,
  );
  return res.json();
}

/** Thrown when a canvas write is rejected due to a concurrent modification. */
export class CanvasConflictError extends Error {
  currentVersion: number | null;
  constructor(currentVersion: number | null) {
    super("canvas_conflict");
    this.currentVersion = currentVersion;
  }
}

/** Thrown when a canvas write is rejected because the workflow is locked by an active deployment. */
export class CanvasLockedError extends Error {
  lockedBy: string | null;
  lockedAt: string | null;
  constructor(lockedBy: string | null, lockedAt: string | null) {
    super("canvas_locked");
    this.lockedBy = lockedBy;
    this.lockedAt = lockedAt;
  }
}

export async function saveEnvCanvas(
  projectId: string,
  envId: string,
  canvas: unknown,
  session: Session,
  expectedVersion?: number,
  opts?: { keepalive?: boolean },
): Promise<void> {
  const body =
    expectedVersion !== undefined
      ? { ...(canvas as object), expectedVersion }
      : canvas;
  const res = opts?.keepalive
    ? await fetch(`${API_URL}/api/environments/${projectId}/${envId}/canvas`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        keepalive: true,
      })
    : await authorizedFetch(
        `${API_URL}/api/environments/${projectId}/${envId}/canvas`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as {
      currentVersion?: number;
    };
    throw new CanvasConflictError(data.currentVersion ?? null);
  }
  if (res.status === 423) {
    const data = (await res.json().catch(() => ({}))) as {
      lockedBy?: string;
      lockedAt?: string;
    };
    throw new CanvasLockedError(data.lockedBy ?? null, data.lockedAt ?? null);
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as any).error ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
}

export async function saveCanvasApi(
  projectId: string,
  canvas: unknown,
  session: Session,
  expectedVersion?: number,
  opts?: { keepalive?: boolean },
): Promise<void> {
  const body =
    expectedVersion !== undefined ? { canvas, expectedVersion } : { canvas };
  const res = opts?.keepalive
    ? await fetch(`${API_URL}/api/projects/${projectId}/canvas`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        keepalive: true,
      })
    : await authorizedFetch(`${API_URL}/api/projects/${projectId}/canvas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as {
      currentVersion?: number;
    };
    throw new CanvasConflictError(data.currentVersion ?? null);
  }
  if (res.status === 423) {
    const data = (await res.json().catch(() => ({}))) as {
      lockedBy?: string;
      lockedAt?: string;
    };
    throw new CanvasLockedError(data.lockedBy ?? null, data.lockedAt ?? null);
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as any).error ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
}

export async function getLockStatus(
  projectId: string,
  session: Session,
): Promise<{
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  ageSeconds: number;
}> {
  const res = await apiFetch(`/api/projects/${projectId}/lock-status`, session);
  return res.json();
}

export async function forceUnlockCanvas(
  projectId: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/force-unlock`, session, {
    method: "POST",
  });
}

export async function importProjectApi(
  name: string,
  canvas: unknown,
  session: Session,
): Promise<{ id: string; name: string }> {
  const res = await apiFetch("/api/projects/import", session, {
    method: "POST",
    body: JSON.stringify({ name, canvas }),
  });
  return res.json();
}

export async function checkWorkflowResourceHealth(
  projectId: string,
  session: Session,
): Promise<Array<{ nodeId: string; alive: boolean }>> {
  const res = await apiFetch(
    `/api/projects/${projectId}/resource-health`,
    session,
  );
  const data = (await res.json()) as {
    results?: Array<{ nodeId: string; alive: boolean }>;
  };
  return data.results ?? [];
}

export interface VercelDomainVerification {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

export interface VercelDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: VercelDomainVerification[];
  cname?: string;
  cfAvailable?: boolean;
}

export async function listVercelDomains(
  projectId: string,
  session: Session,
): Promise<VercelDomain[]> {
  const res = await apiFetch(
    `/api/vercel/projects/${projectId}/domains`,
    session,
  );
  return res.json();
}

export async function getVercelDeploymentState(
  deploymentId: string,
  session: Session,
): Promise<{ readyState: string; url: string | null }> {
  const res = await apiFetch(
    `/api/vercel/deployments/${encodeURIComponent(deploymentId)}/state`,
    session,
  );
  return res.json();
}

export async function addVercelDomain(
  projectId: string,
  name: string,
  session: Session,
): Promise<VercelDomain> {
  const res = await apiFetch(
    `/api/vercel/projects/${projectId}/domains`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
  );
  return res.json();
}

export async function removeVercelDomain(
  projectId: string,
  domain: string,
  session: Session,
): Promise<void> {
  await apiFetch(
    `/api/vercel/projects/${projectId}/domains/${domain}`,
    session,
    {
      method: "DELETE",
    },
  );
}

export async function addCfDnsForVercelDomain(
  projectId: string,
  domain: VercelDomain,
  session: Session,
): Promise<{ added: string[]; skipped: string[] }> {
  const res = await apiFetch(
    `/api/vercel/projects/${projectId}/domains/${encodeURIComponent(domain.name)}/cf-dns`,
    session,
    {
      method: "POST",
      body: JSON.stringify({
        cname: domain.cname,
        verification: domain.verification,
      }),
    },
  );
  return res.json();
}

export interface VercelScannedProject {
  id: string;
  name: string;
  link?: { org?: string; repo?: string };
  supabaseRef?: string;
}

export interface SupabaseScannedProject {
  ref: string;
  name: string;
  region?: string;
}

export interface ScanConnection {
  fromService: "vercel" | "supabase";
  fromRef: string;
  toService: "vercel" | "supabase";
  toRef: string;
}

export async function scanVercelProjects(
  session: Session,
): Promise<VercelScannedProject[]> {
  const res = await apiFetch("/api/vercel/projects", session);
  return res.json();
}

export async function scanSupabaseProjects(
  session: Session,
): Promise<SupabaseScannedProject[]> {
  const res = await apiFetch("/api/supabase/projects", session);
  return res.json();
}

export interface NodeUsageData {
  lastDeploy?: { createdAt: number; state: string; url?: string };
  db_size?: number;
  mau?: number;
}

export async function getWorkflowUsage(
  projectId: string,
  session: Session,
): Promise<{ usage: Record<string, NodeUsageData> }> {
  const res = await apiFetch(`/api/usage/${projectId}`, session);
  return res.json();
}

export interface UserWebhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  secret?: string; // only present on creation response
}

export async function listWebhooks(session: Session): Promise<UserWebhook[]> {
  const res = await apiFetch("/api/webhooks", session);
  return res.json();
}

export async function createWebhook(
  url: string,
  events: string[],
  session: Session,
): Promise<UserWebhook> {
  const res = await apiFetch("/api/webhooks", session, {
    method: "POST",
    body: JSON.stringify({ url, events }),
  });
  return res.json();
}

export async function deleteWebhook(
  id: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/webhooks/${id}`, session, { method: "DELETE" });
}

export async function testWebhook(
  id: string,
  session: Session,
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/webhooks/${id}/test`, session, {
    method: "POST",
  });
  return res.json();
}

export interface StackDrift {
  id: string;
  node_id: string;
  service: "vercel" | "supabase" | "github" | "cloudflare";
  resource_id: string;
  drift_type: "resource_missing" | "env_removed" | "domain_removed" | "paused";
  field: string;
  expected: unknown;
  actual: unknown;
  detected_at: string;
}

export async function listDrifts(
  projectId: string,
  session: Session,
): Promise<StackDrift[]> {
  const res = await apiFetch(`/api/drifts?projectId=${projectId}`, session);
  return res.json();
}

export interface Incident {
  id: string;
  service: string;
  resource_id: string;
  severity: "5xx" | "error" | "warning";
  status_code: number | null;
  path: string | null;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  status: "open" | "resolved" | "acknowledged";
  log_snippet: string | null;
  postmortem: string | null;
  occurrence_count: number | null;
}

export async function listOpenIncidents(
  projectId: string,
  session: Session,
): Promise<Incident[]> {
  try {
    const res = await apiFetch(
      `/api/incidents?projectId=${projectId}`,
      session,
    );
    return res.json();
  } catch {
    return [];
  }
}

export async function listAllIncidents(
  projectId: string,
  session: Session,
): Promise<Incident[]> {
  const res = await apiFetch(
    `/api/incidents?projectId=${projectId}&history=true`,
    session,
  );
  return res.json();
}

export async function resolveIncident(
  incidentId: string,
  session: Session,
  source?: string,
): Promise<void> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  await apiFetch(`/api/incidents/${incidentId}/resolve${qs}`, session, {
    method: "POST",
  });
}

export async function acknowledgeIncident(
  incidentId: string,
  session: Session,
  source?: string,
): Promise<void> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  await apiFetch(`/api/incidents/${incidentId}/acknowledge${qs}`, session, {
    method: "POST",
  });
}

export type AutopilotLevel = "observe" | "suggest" | "auto_safe" | "full";
export type AutopilotActionType =
  | "acknowledge_incident"
  | "resolve_incident"
  | "reconcile_drift"
  | "reprovision_resource"
  | "rollback";
export type AutopilotActionStatus =
  | "executed"
  | "pending"
  | "rejected"
  | "failed";

export interface AutopilotAction {
  id: string;
  project_id: string;
  incident_id: string | null;
  action_type: AutopilotActionType;
  status: AutopilotActionStatus;
  executed_at: string | null;
  notes: string | null;
  created_at: string;
}

export async function getAutopilotPolicy(
  projectId: string,
  session: Session,
): Promise<{ level: AutopilotLevel }> {
  const res = await apiFetch(
    `/api/projects/${projectId}/autopilot-policy`,
    session,
  );
  return res.json();
}

export async function setAutopilotPolicy(
  projectId: string,
  level: AutopilotLevel,
  session: Session,
): Promise<{ level: AutopilotLevel }> {
  const res = await apiFetch(
    `/api/projects/${projectId}/autopilot-policy`,
    session,
    {
      method: "PUT",
      body: JSON.stringify({ level }),
    },
  );
  return res.json();
}

export async function listAutopilotActions(
  projectId: string,
  session: Session,
): Promise<AutopilotAction[]> {
  const res = await apiFetch(
    `/api/projects/${projectId}/autopilot-actions`,
    session,
  );
  return res.json();
}

export async function decideAutopilotAction(
  projectId: string,
  actionId: string,
  decision: "approved" | "rejected",
  session: Session,
): Promise<{ ok: true }> {
  const res = await apiFetch(
    `/api/projects/${projectId}/autopilot-actions/${actionId}`,
    session,
    {
      method: "PATCH",
      body: JSON.stringify({ decision }),
    },
  );
  return res.json();
}

export async function ignoreDrift(
  driftId: string,
  session: Session,
  source?: string,
): Promise<void> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  await apiFetch(`/api/drifts/${driftId}/ignore${qs}`, session, {
    method: "POST",
  });
}

export async function reconcileDrift(
  driftId: string,
  session: Session,
  source?: string,
): Promise<void> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  await apiFetch(`/api/drifts/${driftId}/reconcile${qs}`, session, {
    method: "POST",
  });
}

export async function reprovisionResource(
  driftId: string,
  session: Session,
  confirm?: boolean,
  source?: string,
): Promise<{ ok: true; stack_id: string }> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await apiFetch(
    `/api/drifts/${driftId}/reprovision${qs}`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ confirm: confirm === true }),
    },
  );
  return res.json();
}

export async function runJob(
  job: "drift_check" | "uptime_check" | "security_check",
  session: Session,
  projectId?: string,
): Promise<{ ok: true; job: string }> {
  const res = await apiFetch("/api/jobs/run", session, {
    method: "POST",
    body: JSON.stringify({ job, projectId }),
  });
  return res.json();
}

export interface ProjectLogs {
  vercel?: {
    projectId: string;
    deployments: Array<{
      id: string;
      url: string | null;
      state: string;
      createdAt: number;
      commitMessage: string | null;
      commitRef: string | null;
      branch: string | null;
    }>;
  };
  github?: {
    repoName: string;
    commits: Array<{
      sha: string;
      message: string;
      author: string;
      date: string;
      url: string;
    }>;
  };
  supabase?: {
    ref: string;
    name: string;
    status: string;
    region: string;
    createdAt: string;
  };
  resend?: {
    emails: Array<{
      id: string;
      from: string;
      to: string[];
      subject: string;
      createdAt: string;
      lastEvent: string;
    }>;
  };
}

export async function fetchProjectLogs(
  projectId: string,
  session: Session,
): Promise<ProjectLogs> {
  const res = await apiFetch(`/api/logs/${projectId}`, session);
  return res.json();
}

export interface BuildLogEntry {
  text: string;
  date: number;
  type: string;
}

export async function fetchBuildLogs(
  deploymentId: string,
  session: Session,
): Promise<BuildLogEntry[]> {
  const res = await apiFetch(
    `/api/vercel/deployments/${encodeURIComponent(deploymentId)}/build-logs`,
    session,
  );
  const data = (await res.json()) as { logs?: BuildLogEntry[] };
  return data.logs ?? [];
}

export async function createWorkflowFromScan(
  name: string,
  vercelProjects: VercelScannedProject[],
  supabaseProjects: SupabaseScannedProject[],
  githubRepos: GitHubRepo[],
  connections: ScanConnection[],
  session: Session,
): Promise<{ id: string; name: string }> {
  const res = await apiFetch("/api/projects/from-scan", session, {
    method: "POST",
    body: JSON.stringify({
      name,
      vercelProjects,
      supabaseProjects,
      githubRepos: githubRepos.map((r) => ({ full_name: r.full_name })),
      connections,
    }),
  });
  return res.json();
}

export interface AuditLogEntry {
  id: string;
  event: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export async function fetchAuditLog(
  session: Session,
  opts?: { limit?: number; offset?: number; events?: string[] },
): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (opts?.events?.length) params.set("events", opts.events.join(","));
  const qs = [...params.keys()].length ? `?${params}` : "";
  const res = await apiFetch(`/api/audit-log${qs}`, session);
  return res.json();
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scope: "read" | "write";
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyCreated extends ApiKey {
  key: string; // raw key — shown once
}

export async function listApiKeys(session: Session): Promise<ApiKey[]> {
  const res = await apiFetch("/api/keys", session);
  return res.json();
}

export async function createApiKey(
  name: string,
  scope: "read" | "write",
  session: Session,
): Promise<ApiKeyCreated> {
  const res = await apiFetch("/api/keys", session, {
    method: "POST",
    body: JSON.stringify({ name, scope }),
  });
  return res.json();
}

export async function revokeApiKey(
  id: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/keys/${id}`, session, { method: "DELETE" });
}

// ── Multi-environment API ────────────────────────────────────

export interface WorkflowEnvironment {
  id: string;
  workflow_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  display_order: number;
  created_at: string;
  parent_id?: string | null;
}

export interface EnvNodeState {
  status?: string;
  provisionedAt?: string;
  stackId?: string;
  provisionedUrl?: string;
  vercelProjectId?: string;
  supabaseProjectRef?: string;
  githubRepoName?: string;
  cfWorkerNameProvisioned?: string;
  cfBucketNameProvisioned?: string;
  cloudflareWorkerUrl?: string;
  r2Endpoint?: string;
  cloudflareAccountId?: string;
  errorMsg?: string;
  [key: string]: unknown;
}

export async function listEnvironments(
  projectId: string,
  session: Session,
): Promise<WorkflowEnvironment[]> {
  // apiFetch throws on non-2xx; callers must catch. No dead ok-guard here.
  const res = await apiFetch(`/api/environments/${projectId}`, session);
  return res.json();
}

export async function createEnvironment(
  projectId: string,
  name: string,
  slug: string,
  session: Session,
): Promise<WorkflowEnvironment> {
  const res = await apiFetch(`/api/environments/${projectId}`, session, {
    method: "POST",
    body: JSON.stringify({ name, slug }),
  });
  return res.json();
}

export async function renameEnvironment(
  projectId: string,
  envId: string,
  name: string,
  session: Session,
): Promise<WorkflowEnvironment> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${envId}`,
    session,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return res.json();
}

export async function deleteEnvironmentApi(
  projectId: string,
  envId: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/environments/${projectId}/${envId}`, session, {
    method: "DELETE",
  });
}

export async function getEnvNodeStates(
  projectId: string,
  envId: string,
  session: Session,
): Promise<Record<string, EnvNodeState>> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${envId}/node-state`,
    session,
  );
  return res.json();
}

export async function getEnvSecrets(
  projectId: string,
  envId: string,
  session: Session,
): Promise<
  Array<{ node_id: string; env_var_key: string; updated_at: string }>
> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${envId}/secrets`,
    session,
  );
  return res.json();
}

export async function putEnvSecret(
  projectId: string,
  envId: string,
  nodeId: string,
  key: string,
  value: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/environments/${projectId}/${envId}/secrets`, session, {
    method: "PUT",
    body: JSON.stringify({ nodeId, key, value }),
  });
}

export async function deleteEnvSecretApi(
  projectId: string,
  envId: string,
  nodeId: string,
  key: string,
  session: Session,
): Promise<void> {
  await apiFetch(
    `/api/environments/${projectId}/${envId}/secrets/${encodeURIComponent(nodeId)}/${encodeURIComponent(key)}`,
    session,
    { method: "DELETE" },
  );
}

export async function branchEnvironment(
  projectId: string,
  parentEnvId: string,
  name: string,
  slug: string,
  session: Session,
): Promise<WorkflowEnvironment> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${parentEnvId}/branch`,
    session,
    { method: "POST", body: JSON.stringify({ name, slug }) },
  );
  return res.json();
}

export async function promoteEnvironment(
  projectId: string,
  envId: string,
  session: Session,
): Promise<{ ok: boolean; copied: number }> {
  const res = await apiFetch(
    `/api/environments/${projectId}/${envId}/promote`,
    session,
    { method: "POST" },
  );
  return res.json();
}

export async function getNotificationPrefs(session: Session): Promise<{
  daily_digest: boolean;
  alert_critical: boolean;
  cost_alert_threshold_usd: number | null;
  cost_anomaly_enabled: boolean;
  slack_webhook_configured?: boolean;
}> {
  const res = await apiFetch("/api/notifications/prefs", session);
  if (!res.ok)
    return {
      daily_digest: true,
      alert_critical: true,
      cost_alert_threshold_usd: null,
      cost_anomaly_enabled: true,
      slack_webhook_configured: false,
    };
  return res.json();
}

export async function updateNotificationPrefs(
  prefs: {
    daily_digest?: boolean;
    alert_critical?: boolean;
    cost_alert_threshold_usd?: number | null;
    cost_anomaly_enabled?: boolean;
  },
  session: Session,
): Promise<void> {
  await apiFetch("/api/notifications/prefs", session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

// --- Alert rules (custom thresholds → Slack / email) ---

export type AlertMetric = "cost_month_usd" | "uptime_percent" | "error_rate";
export type AlertOperator = "gt" | "lt" | "gte" | "lte";
export type AlertChannel = "slack" | "email";

export interface AlertRule {
  id: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  channel: AlertChannel;
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
}

export async function listAlertRules(
  projectId: string,
  session: Session,
): Promise<AlertRule[]> {
  const res = await apiFetch(
    `/api/alert-rules?projectId=${projectId}`,
    session,
  );
  if (!res.ok) return [];
  return res.json();
}

export async function createAlertRule(
  input: {
    projectId: string;
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    channel: AlertChannel;
  },
  session: Session,
): Promise<AlertRule> {
  const res = await apiFetch("/api/alert-rules", session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create alert rule");
  return res.json();
}

export async function updateAlertRule(
  id: string,
  patch: Partial<
    Pick<AlertRule, "threshold" | "operator" | "channel" | "enabled">
  >,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/alert-rules/${id}`, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteAlertRule(
  id: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/alert-rules/${id}`, session, { method: "DELETE" });
}

export async function setSlackWebhook(
  url: string,
  session: Session,
): Promise<void> {
  const res = await apiFetch("/api/alert-rules/slack-webhook", session, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? "Failed to save Slack webhook",
    );
  }
}

export async function clearSlackWebhook(session: Session): Promise<void> {
  await apiFetch("/api/alert-rules/slack-webhook", session, {
    method: "DELETE",
  });
}

export async function getNotificationCount(
  session: Session,
): Promise<{ total: number; incidents: number; drifts: number }> {
  const res = await apiFetch("/api/notifications/count", session);
  if (!res.ok) return { total: 0, incidents: 0, drifts: 0 };
  return res.json();
}

export interface ProjectHealthSnapshot {
  critical_incidents: number;
  total_incidents: number;
  critical_drifts: number;
  total_drifts: number;
  last_deploy_status: string | null;
}

export async function getProjectsHealthOverview(
  session: Session,
): Promise<Record<string, ProjectHealthSnapshot>> {
  const res = await apiFetch("/api/projects/health-overview", session);
  if (!res.ok) return {};
  return res.json();
}

export interface UptimeNodeSummary {
  status: "up" | "down" | "unknown";
  uptime7d: number;
  lastLatencyMs: number | null;
  sparkline: number[];
}

export async function getProjectUptime(
  projectId: string,
  session: Session,
): Promise<Record<string, UptimeNodeSummary>> {
  const res = await apiFetch(`/api/projects/${projectId}/uptime`, session);
  if (!res.ok) return {};
  return res.json();
}

export interface CostSummary {
  byProvider: Record<
    string,
    {
      thisMonth: number;
      daily: Array<{ date: string; amount: number }>;
      isEstimate: boolean;
      projectedMonthEnd: number;
    }
  >;
  totalThisMonth: number;
  projectedMonthEnd: number;
}

export async function getCostSummary(
  projectId: string,
  session: Session,
): Promise<CostSummary | null> {
  const res = await apiFetch(`/api/projects/${projectId}/cost`, session);
  if (!res.ok) return null;
  return res.json();
}

export interface ObservabilityData {
  cloudflare: {
    requests24h: number;
    errorRate: number;
    cpuP50Ms: number;
    cpuP99Ms: number;
  } | null;
  vercel: {
    successRate7d: number;
    totalDeploys7d: number;
    avgBuildMs: number;
  } | null;
  supabase: {
    projectStatus: string;
    region: string;
  } | null;
  fetchedAt: string;
}

export async function getObservability(
  projectId: string,
  session: Session,
): Promise<ObservabilityData | null> {
  const res = await apiFetch(
    `/api/projects/${projectId}/observability`,
    session,
  );
  if (!res.ok) return null;
  return res.json();
}

export interface MetricPoint {
  capturedAt: string;
  metrics: Record<string, number | string>;
}
export type ObservabilityHistory = Record<string, MetricPoint[]>;

export async function getObservabilityHistory(
  projectId: string,
  session: Session,
): Promise<ObservabilityHistory> {
  const res = await apiFetch(
    `/api/projects/${projectId}/observability/history`,
    session,
  );
  if (!res.ok) return {};
  return res.json();
}

// --- Dashboard conversation history ---

export interface ConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationFull extends ConversationMeta {
  messages: object[];
}

export async function listDashboardChats(
  projectId: string,
  session: Session,
): Promise<ConversationMeta[]> {
  const res = await apiFetch(
    `/api/dashboard-chats?project_id=${projectId}`,
    session,
  );
  return res.json();
}

export async function getDashboardChat(
  id: string,
  session: Session,
): Promise<ConversationFull> {
  const res = await apiFetch(`/api/dashboard-chats/${id}`, session);
  return res.json();
}

export async function createDashboardChat(
  projectId: string,
  title: string,
  messages: object[],
  session: Session,
): Promise<ConversationFull> {
  const res = await apiFetch(`/api/dashboard-chats`, session, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, title, messages }),
  });
  return res.json();
}

export async function updateDashboardChat(
  id: string,
  updates: { messages?: object[]; title?: string },
  session: Session,
): Promise<void> {
  await apiFetch(`/api/dashboard-chats/${id}`, session, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteDashboardChat(
  id: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/dashboard-chats/${id}`, session, {
    method: "DELETE",
  });
}

// ── Channels (AI DevOps engineer over Slack/WhatsApp) ────────────────────────

export interface ChannelIdentity {
  id: string;
  channel: string;
  external_id: string;
  team_id: string | null;
  linked_at: string;
}

export interface LinkCodeResponse {
  code: string;
  channel: string;
  expiresInMinutes: number;
}

export async function generateChannelLinkCode(
  channel: string,
  session: Session,
): Promise<LinkCodeResponse> {
  const res = await apiFetch("/api/channels/link-code", session, {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
  return res.json();
}

export async function listChannelIdentities(
  session: Session,
): Promise<ChannelIdentity[]> {
  const res = await apiFetch("/api/channels", session);
  const data = (await res.json()) as { identities?: ChannelIdentity[] };
  return data.identities ?? [];
}

export async function unlinkChannel(
  id: string,
  session: Session,
): Promise<void> {
  await apiFetch(`/api/channels/${id}`, session, { method: "DELETE" });
}

// ── Database (Task 7 shell — Tables/SQL Editor land in Tasks 8/9) ──────────

export async function getDatabaseSchema(
  session: Session,
  projectId: string,
  nodeId: string,
): Promise<{ schema: LiveSchema }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/schema`,
    session,
  );
  return res.json();
}

export async function fetchTableRows(
  session: Session,
  projectId: string,
  nodeId: string,
  table: string,
  opts?: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: "asc" | "desc";
  },
): Promise<RowsPage> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  if (opts?.orderBy) params.set("orderBy", opts.orderBy);
  if (opts?.orderDir) params.set("orderDir", opts.orderDir);
  const qs = params.toString();

  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/tables/${table}/rows${qs ? `?${qs}` : ""}`,
    session,
  );
  return res.json();
}

// Row insert/update/delete by PK — provisioned nodes only (409 otherwise).
// See workers/api/src/routes/database.ts's POST/PATCH/DELETE
// .../tables/:table/rows for the backend implementation. Route-only (no MCP
// tool) — row editing is a console UI feature, not an agent tool.
export async function insertTableRow(
  session: Session,
  projectId: string,
  nodeId: string,
  table: string,
  values: Record<string, unknown>,
): Promise<QueryResult> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/tables/${table}/rows`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ values }),
    },
  );
  return res.json();
}

export async function updateTableRow(
  session: Session,
  projectId: string,
  nodeId: string,
  table: string,
  pk: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<QueryResult> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/tables/${table}/rows`,
    session,
    {
      method: "PATCH",
      body: JSON.stringify({ pk, values }),
    },
  );
  return res.json();
}

export async function deleteTableRow(
  session: Session,
  projectId: string,
  nodeId: string,
  table: string,
  pk: Record<string, unknown>,
): Promise<QueryResult> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/tables/${table}/rows`,
    session,
    {
      method: "DELETE",
      body: JSON.stringify({ pk }),
    },
  );
  return res.json();
}

export async function runDatabaseQuery(
  session: Session,
  projectId: string,
  nodeId: string,
  sql: string,
  mode: "read" | "write",
): Promise<{ result: QueryResult; durationMs: number }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/query`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ sql, mode }),
    },
  );
  return res.json();
}

// Provisioned nodes: granular live edit (drop/alter/index/RLS). Draft nodes:
// translated onto the canvas seed. See workers/api/src/routes/database.ts's
// POST /mutate for the backend implementation.
export async function mutateDatabaseSchema(
  session: Session,
  projectId: string,
  nodeId: string,
  mutation: SchemaMutation,
): Promise<{
  ok: true;
  applied_to?: "live" | "canvas";
  result?: QueryResult;
  durationMs?: number;
  appliedToCanvas?: boolean;
}> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/mutate`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ mutation }),
    },
  );
  return res.json();
}

// Draft-only whole-array table persistence for the Tables tab seed editor.
// Provisioned nodes reject this with 409 — see workers/api/src/routes/database.ts's
// PUT /tables for the backend implementation.
export async function setDatabaseTables(
  session: Session,
  projectId: string,
  nodeId: string,
  tables: TableDef[],
): Promise<{ ok: true }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/tables`,
    session,
    {
      method: "PUT",
      body: JSON.stringify({ tables }),
    },
  );
  return res.json();
}

// Extensions tab (Task 9 UI). Provisioned nodes only — see
// workers/api/src/routes/database.ts's GET/POST .../extensions for the
// backend implementation. introspectExtensions always returns exactly the
// closed whitelist (schema/extensions.ts), annotated with live install state.
export async function fetchExtensions(
  session: Session,
  projectId: string,
  nodeId: string,
): Promise<{ extensions: ExtensionInfo[] }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/extensions`,
    session,
  );
  return res.json();
}

export async function setExtension(
  session: Session,
  projectId: string,
  nodeId: string,
  name: string,
  enabled: boolean,
): Promise<{ ok: true; result?: QueryResult }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/extensions`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ name, enabled }),
    },
  );
  return res.json();
}

// Saved SQL snippets (SQL editor). These hit LEENAR'S OWN Postgres — see
// workers/api/src/routes/database.ts's GET/POST/DELETE .../snippets for the
// backend implementation. Scoped by user+project+node; not tied to the
// user's Supabase project or its provisioning state.
export async function listSnippets(
  session: Session,
  projectId: string,
  nodeId: string,
): Promise<{ snippets: Snippet[] }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/snippets`,
    session,
  );
  return res.json();
}

export async function createSnippet(
  session: Session,
  projectId: string,
  nodeId: string,
  name: string,
  sql: string,
): Promise<{ snippet: Snippet }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/snippets`,
    session,
    {
      method: "POST",
      body: JSON.stringify({ name, sql }),
    },
  );
  return res.json();
}

export async function deleteSnippet(
  session: Session,
  projectId: string,
  nodeId: string,
  snippetId: string,
): Promise<{ ok: true }> {
  const res = await apiFetch(
    `/api/database/${projectId}/${nodeId}/snippets/${snippetId}`,
    session,
    { method: "DELETE" },
  );
  return res.json();
}
