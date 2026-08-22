import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  useOnSelectionChange,
  useReactFlow,
  ConnectionMode,
  SelectionMode,
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { NodeDeletionModal } from "./NodeDeletionModal";
import { DeploySuccessModal, type SuccessService } from "./DeploySuccessModal";
import { PreDeployModal } from "./PreDeployModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { DriftReviewModal } from "./DriftReviewModal";
import { AiDiagnosisCard } from "./AiDiagnosisCard";
import { EmptyCanvasHint } from "./EmptyCanvasHint";
import { ScanAccountsModal } from "./ScanAccountsModal";
import { nodeTypes, edgeTypes } from "./canvasConstants";
import { ServiceDrawer } from "./ServiceDrawer";
import { EdgeEditor } from "./EdgeEditor";
import { Toolbar } from "./Toolbar";
import { ChatPanel } from "../chat/ChatPanel";
import { TerminalConsole } from "../observability/TerminalConsole";
import { ContextMenu } from "./ContextMenu";
import { VercelGitHubBanner } from "./VercelGitHubBanner";
import { IntegrationBanner } from "./IntegrationBanner";
import {
  stepsToNewLogs,
  SERVICE_DISPLAY,
  applyAutoLayout,
  inferServiceType,
} from "./workspaceHelpers";
import { needsAutoLayout } from "./edgeDisplay";
import { buildTemplateCanvas } from "./workspaceTemplates";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useCanvasImportExport } from "./hooks/useCanvasImportExport";
import {
  useWorkflowPersistence,
  backupKeyFor,
  backupMatchesServer,
} from "./hooks/useWorkflowPersistence";
import { useDeployFlow } from "./hooks/useDeployFlow";
import { useNodeGrouping } from "./hooks/useNodeGrouping";
import { useCanvasShortcuts } from "./hooks/useCanvasShortcuts";
import { useNodeMenuDispatcher } from "./hooks/useNodeMenuDispatcher";
import { useNodeDeletion } from "./hooks/useNodeDeletion";
import { useCanvasEdges } from "./hooks/useCanvasEdges";
import { useAiCanvasUpdate } from "./hooks/useAiCanvasUpdate";
import { useSelectedNodeRelations } from "./hooks/useSelectedNodeRelations";
import { useUsageMonitoring } from "./hooks/useUsageMonitoring";
import { useDriftMonitoring } from "./hooks/useDriftMonitoring";
import { useIncidentMonitoring } from "./hooks/useIncidentMonitoring";
import { isCloud } from "../../lib/cloud";
import { renameProject } from "../../lib/workflows";
import type { CanvasUpdatePayload } from "../../lib/api";
import {
  importNode,
  getResendDomains,
  getGitHubRepos,
  listVercelDomains,
  addVercelDomain,
  removeVercelDomain,
  addCfDnsForVercelDomain,
  createResendDomain,
  getResendDomainRecords,
  deleteResendDomain,
  startOAuthFlow,
  listEnvironments,
  getEnvNodeStates,
  getEnvCanvas,
  type WorkflowEnvironment,
  type EnvNodeState,
} from "../../lib/api";
import { EnvManageModal } from "./EnvManageModal";
import { useAuth } from "../../context/auth";
import { useOnboarding } from "../../context/onboarding";
import { ComponentErrorBoundary } from "../ui/ComponentErrorBoundary";
import { ENV_FLOW, resolveEnvKeys } from "../../lib/envFlow";

interface ProjectCanvasInnerProps {
  projectId: string;
  template?: string;
}

function ProjectCanvasInner({ projectId, template }: ProjectCanvasInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedNodesArray, setSelectedNodesArray] = useState<Node[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  const [colorMode, setColorMode] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("light") ? "light" : "dark",
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setColorMode(
        document.documentElement.classList.contains("light") ? "light" : "dark",
      ),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  // Keep selectedNode in sync with nodes state so callbacks like onAddVercelDomain
  // always use the latest node data (e.g. vercelProjectId added after provisioning).
  useEffect(() => {
    if (!selectedNode) return;
    const fresh = nodes.find((n) => n.id === selectedNode.id);
    if (fresh && fresh.data !== selectedNode.data) {
      setSelectedNode(fresh);
    }
  }, [nodes, selectedNode]);

  // Keep selectedEdge in sync with edges state so EdgeEditor always shows current data
  // (e.g. synced:true stamped by deploy, or envVars changed by an external update).
  useEffect(() => {
    if (!selectedEdge) return;
    const fresh = edges.find((e) => e.id === selectedEdge.id);
    if (fresh && fresh.data !== selectedEdge.data) {
      setSelectedEdge(fresh);
    }
  }, [edges, selectedEdge]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPreDeploy, setShowPreDeploy] = useState(false);
  const [showDriftModal, setShowDriftModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showEnvManage, setShowEnvManage] = useState(false);
  const [environments, setEnvironments] = useState<WorkflowEnvironment[]>([]);
  const [currentEnvId, setCurrentEnvId] = useState<string | null>(null);
  const [envNodeStates, setEnvNodeStates] = useState<
    Record<string, EnvNodeState>
  >({});
  const clipboardRef = useRef<Node[]>([]);
  const pasteOffsetRef = useRef(0);
  const envSwitchGenRef = useRef(0);

  const navigate = useNavigate();
  const { session } = useAuth();
  const { actions } = useOnboarding();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const {
    screenToFlowPosition,
    fitView,
    toObject,
    setNodes: setNodesFlow,
    setEdges: setEdgesFlow,
    getInternalNode,
    setViewport,
  } = useReactFlow();

  // Latest resetBaseline from useWorkflowPersistence (assigned after the hook
  // runs, below). loadEnvCanvas is defined before the hook, so it reaches it via
  // this ref. Marking the just-loaded env canvas as the saved baseline stops the
  // debounced auto-save from re-writing content that already matches the server.
  const resetBaselineRef = useRef<((n: Node[], e: Edge[]) => void) | null>(
    null,
  );

  // Load env canvas and replace nodes/edges/viewport
  const loadEnvCanvas = useCallback(
    async (envId: string): Promise<number | null> => {
      if (!session || !projectId || projectId === "new") return null;
      try {
        setSelectedNode(null);
        setIsSidebarOpen(false);
        setEnvNodeStates({});
        const canvas = await getEnvCanvas(projectId, envId, session);
        const loadedNodes = (canvas.nodes as Node[]) ?? [];
        const arrangedNodes = needsAutoLayout(loadedNodes)
          ? applyAutoLayout(loadedNodes, (canvas.edges as Edge[]) ?? [])
          : loadedNodes;
        setNodes(
          arrangedNodes.map((n) => ({
            ...n,
            selected: false,
          })),
        );
        setEdges((canvas.edges as Edge[]) ?? []);
        if (canvas.viewport) setViewport(canvas.viewport as any);

        // Restore local backup if present (covers failed saves or tab-close
        // mid-edit). Scoped to this env, and compared against the ENV canvas we
        // just loaded — auto-save targets the env canvas, so the project canvas
        // was the wrong thing to diff against. Track which node/edge set ends up
        // active in local variables (not React state, whose updates are async)
        // so the baseline below reflects the restored content when applicable.
        let activeNodes = arrangedNodes;
        let activeEdges = (canvas.edges as Edge[]) ?? [];
        const backupKey = backupKeyFor(projectId, envId);
        const backup = localStorage.getItem(backupKey);
        if (backup) {
          try {
            const { nodes: bn, edges: be, viewport: bv } = JSON.parse(backup);
            if (Array.isArray(bn)) {
              if (
                backupMatchesServer(
                  { nodes: bn, edges: be ?? [] },
                  {
                    nodes: (canvas.nodes as Node[]) ?? [],
                    edges: (canvas.edges as Edge[]) ?? [],
                  },
                )
              ) {
                // Backup is identical to the env canvas — stale leftover from a
                // recovered failure. The env canvas we already set stands.
                localStorage.removeItem(backupKey);
              } else {
                // Genuine unsaved local content — restore it over the env canvas.
                toast.info(
                  "Unsaved local changes found — they have been restored. Save to keep them.",
                  {
                    duration: 8000,
                    action: {
                      label: "Discard",
                      onClick: () => {
                        localStorage.removeItem(backupKey);
                        window.location.reload();
                      },
                    },
                  },
                );
                setNodes(bn as Node[]);
                setEdges((be ?? []) as Edge[]);
                if (bv) setViewport(bv);
                activeNodes = bn as Node[];
                activeEdges = (be ?? []) as Edge[];
              }
            }
          } catch {
            localStorage.removeItem(backupKey);
          }
        }

        // Mark whatever ended up active as the auto-save baseline. If the backup
        // was restored, the baseline reflects bn/be (different from the env
        // canvas) so auto-save correctly persists the restored changes; otherwise
        // it reflects the env canvas so loading it doesn't trigger a redundant
        // write.
        resetBaselineRef.current?.(activeNodes, activeEdges);
        // Load env node states and merge runtime overlay (status, resource IDs).
        // These are runtime-only fields; authoringKey ignores them so this merge
        // updates the display without ever triggering an auto-save.
        const states = await getEnvNodeStates(projectId, envId, session);
        setEnvNodeStates(states);
        if (Object.keys(states).length > 0) {
          setNodes((nds: Node[]) =>
            nds.map((n: Node) => {
              const s = states[n.id];
              if (!s) return n;
              return { ...n, selected: false, data: { ...n.data, ...s } };
            }),
          );
        }
        return typeof canvas.canvas_version === "number"
          ? canvas.canvas_version
          : null;
      } catch {
        /* non-fatal — keep current canvas */
        return null;
      }
    },
    [session, projectId, setNodes, setEdges, setViewport],
  );

  const { takeSnapshot, undo, redo, canUndo, canRedo, clearHistory } =
    useUndoRedo(nodes, edges, setNodesFlow, setEdgesFlow);

  useCanvasShortcuts({
    undo,
    redo,
    fitView,
    selectedNodesArray,
    takeSnapshot,
    setNodes,
    clipboardRef,
    pasteOffsetRef,
    setShowShortcuts,
  });

  const {
    workflowName,
    setWorkflowName,
    workflowStatus,
    workflowIdRef,
    workflowNameRef,
    canSaveRef,
    canvasVersionRef,
    saveState,
    setSaveState,
    currentWorkflowId,
    initialChatMessages,
    flushPendingSave,
    resetBaseline,
  } = useWorkflowPersistence({
    workflowId: projectId,
    template,
    session,
    nodes,
    edges,
    setNodes,
    setEdges,
    setViewport,
    fitView,
    toObject,
    navigate,
    currentEnvId,
  });
  // Expose resetBaseline to loadEnvCanvas (defined above the hook call).
  resetBaselineRef.current = resetBaseline;

  // Load environment list on mount; switch to default env canvas.
  // loadEnvCanvas marks the loaded canvas as the auto-save baseline so it isn't
  // re-written to the wrong endpoint.
  // Capture the returned canvas_version so canvasVersionRef reflects the env
  // canvas version (not the workflow canvas version set by getProject), preventing
  // a stale-version 409 on the first flushPendingSave after mount.
  useEffect(() => {
    if (!session || !projectId || projectId === "new") return;
    listEnvironments(projectId, session)
      .then(async (envs) => {
        setEnvironments(envs);
        const defaultEnv = envs.find((e) => e.is_default) ?? envs[0];
        if (defaultEnv) {
          setCurrentEnvId(defaultEnv.id);
          const envVersion = await loadEnvCanvas(defaultEnv.id);
          if (envVersion !== null) canvasVersionRef.current = envVersion;
          // Auto-save may proceed only now that the env canvas has loaded and
          // canvasVersionRef reflects the env version — this is the fix for the
          // version-init race (previously a 300 ms timeout in the hook could flip
          // canSaveRef before this correction landed, allowing a save against the
          // stale project version).
          canSaveRef.current = true;
        } else {
          // No environments for this project — legacy/edge case. Nothing will
          // populate the canvas or correct canvasVersionRef, but auto-save must
          // not be permanently disabled.
          canSaveRef.current = true;
        }
      })
      .catch(() => {
        // Env fetch failed — leave env switcher uninitialized rather than throwing
        // an unhandled rejection that blocks canvas mount. Auto-save must still
        // be able to proceed (against whatever canvasVersionRef/canvas state exists).
        canSaveRef.current = true;
      });
  }, [projectId, session, loadEnvCanvas, canvasVersionRef, canSaveRef]);

  const {
    isRunning,
    deployLogs,
    setDeployLogs,
    deployStepCount,
    deployError,
    deployErrorMsg,
    aiSuggestion,
    aiSuggestionLoading,
    showSuccessModal,
    setShowSuccessModal,
    successServices,
    completedStackId,
    integrationBanner,
    setIntegrationBanner,
    handleDeployToggle,
    handleNodeRedeploy,
    resetDeployState,
  } = useDeployFlow({
    session,
    workflowIdRef,
    workflowNameRef,
    setSaveState,
    toObject,
    nodes,
    setNodes,
    setEdges,
    navigate,
    setIsTerminalOpen,
    currentEnvId,
    onDeploySuccess: actions.refresh,
  });

  const handleEnvSwitch = useCallback(
    async (envId: string) => {
      if (!session || !projectId) return;
      // Increment generation so any in-flight switch knows it's been superseded
      const gen = ++envSwitchGenRef.current;
      // Flush pending save for the current env before switching
      await flushPendingSave();
      if (gen !== envSwitchGenRef.current) return;
      clearHistory();
      resetDeployState();
      setCurrentEnvId(envId);
      setSelectedNode(null);
      const envVersion = await loadEnvCanvas(envId);
      if (gen !== envSwitchGenRef.current) return;
      // Sync OCC version to the loaded env so the first save doesn't conflict
      if (envVersion !== null) canvasVersionRef.current = envVersion;
    },
    [
      session,
      projectId,
      loadEnvCanvas,
      flushPendingSave,
      clearHistory,
      resetDeployState,
      canvasVersionRef,
    ],
  );

  // Detect OAuth return: ?connected=<svc> param added by oauth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedSvc = params.get("connected");
    if (connectedSvc) {
      history.replaceState({}, "", window.location.pathname);
      const label = SERVICE_DISPLAY[connectedSvc]?.label ?? connectedSvc;
      toast.success(`${label} connected — ready to deploy!`, {
        duration: 5000,
      });
    }
  }, []);

  const connectService = useCallback(
    async (svc: string) => {
      if (!session) return;
      const OAUTH_SERVICES = ["github", "supabase"];
      if (OAUTH_SERVICES.includes(svc)) {
        try {
          const url = await startOAuthFlow(
            svc,
            session,
            window.location.pathname,
          );
          window.location.href = url;
        } catch {
          toast.error(
            `Failed to start ${svc} connection. Try from Integrations.`,
          );
        }
      } else {
        window.location.href = "/console/integrations";
      }
    },
    [session],
  );

  const {
    deletionTarget,
    setDeletionTarget,
    isDeprovisioning,
    handleBeforeDelete,
    handleDeletionConfirm,
    handleDeletionCancel,
  } = useNodeDeletion({
    session,
    workflowIdRef,
    setNodes,
    setEdges,
    isDeploying: isRunning,
  });

  useNodeMenuDispatcher({
    nodes,
    setNodes,
    setSelectedNode,
    setIsSidebarOpen,
    setDeletionTarget,
    takeSnapshot,
  });

  const handleRename = useCallback((name: string) => {
    setWorkflowName(name);
    workflowNameRef.current = name;
    if (workflowIdRef.current !== "new") {
      renameProject(workflowIdRef.current, name).catch(() => {});
    }
  }, []);

  const onAddNode = useCallback(
    (type: string, data: any) => {
      takeSnapshot();
      const id = `${type}-${Date.now()}`;
      const position = menu
        ? screenToFlowPosition({ x: menu.x, y: menu.y })
        : { x: Math.random() * 400, y: Math.random() * 400 };

      const defaultData: any = {};
      if (type === "trigger") {
        defaultData.label = "New Trigger";
        defaultData.subType = "manual";
      } else if (type === "service") {
        defaultData.label = "New Provider";
        defaultData.iconName = "Box";
      } else if (type === "logic") {
        defaultData.label = "New Condition";
        defaultData.iconName = "GitBranch";
      } else if (type === "department") {
        defaultData.label = "New Group";
      }

      const newNode: Node = {
        id,
        type,
        position,
        data: { ...defaultData, ...data },
      };
      setNodes((nds: Node[]) => [...nds, newNode]);
      setMenu(null);
    },
    [setNodes, takeSnapshot, menu, screenToFlowPosition],
  );

  const handleAutoLayout = useCallback(() => {
    takeSnapshot();
    setNodes((nds: Node[]) => applyAutoLayout(nds, edges));
    setTimeout(() => fitView({ duration: 500, padding: 0.2 }), 50);
  }, [takeSnapshot, setNodes, edges, fitView]);

  const { handleExport, handleCanvasImport } = useCanvasImportExport({
    toObject,
    workflowNameRef,
    setWorkflowName,
    setSaveState,
    takeSnapshot,
    setNodesFlow,
    setEdgesFlow,
    setViewport,
  });

  const handleScreenshot = useCallback(async () => {
    const viewportEl = document.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    if (!viewportEl || nodes.length === 0) return;
    const W = 1200;
    const H = 800;
    const bounds = getNodesBounds(nodes);
    const vp = getViewportForBounds(bounds, W, H, 0.4, 2, 0.1);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(viewportEl, {
        // The exported PNG follows the theme rather than always being
        // near-black, which looked wrong for a light-theme user.
        backgroundColor: getComputedStyle(document.documentElement)
          .getPropertyValue("--canvas-bg")
          .trim(),
        width: W,
        height: H,
        style: {
          width: `${W}px`,
          height: `${H}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
          transformOrigin: "top left",
        },
      });
      // Add "Powered by Leenar" watermark
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
      });
      const cvs = document.createElement("canvas");
      cvs.width = W;
      cvs.height = H;
      const ctx = cvs.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--dim")
        .trim();
      ctx.fillText("Powered by Leenar", 12, H - 12);
      const a = document.createElement("a");
      a.download = `${workflowNameRef.current.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-leenar.png`;
      a.href = cvs.toDataURL("image/png");
      a.click();
    } catch {
      toast.error("Screenshot failed — try again");
    }
  }, [nodes, workflowNameRef]);

  const handleImportNode = useCallback(
    async (service: "vercel" | "supabase" | "github", identifier: string) => {
      if (!session) throw new Error("Not authenticated");
      const wfId = workflowIdRef.current;
      if (wfId === "new")
        throw new Error("Save your workflow first before importing nodes");
      takeSnapshot();
      const {
        node,
        edges: newEdges,
        canvas_version,
      } = await importNode(
        wfId,
        service,
        identifier,
        currentEnvId ?? undefined,
        session,
      );
      const nextEdges =
        newEdges && newEdges.length > 0 ? [...edges, ...newEdges] : edges;
      setNodes((nds: Node[]) => {
        const next = [...nds, node];
        resetBaseline(next, nextEdges);
        return next;
      });
      if (newEdges && newEdges.length > 0) {
        setEdges((eds: Edge[]) => [...eds, ...newEdges]);
        toast.success(
          `Auto-connected to ${newEdges.length} existing node${newEdges.length !== 1 ? "s" : ""}`,
        );
      }
      const runtimeFields = [
        "status",
        "provisionedAt",
        "provisionedUrl",
        "vercelProjectId",
        "supabaseProjectRef",
        "githubRepoName",
        "githubRepoUrl",
      ] as const;
      const runtimeState: EnvNodeState = {};
      for (const field of runtimeFields) {
        const value = (node.data as Record<string, unknown>)[field];
        if (value !== undefined) runtimeState[field] = value as string;
      }
      setEnvNodeStates((prev) => ({ ...prev, [node.id]: runtimeState }));
      canvasVersionRef.current = canvas_version;
      toast.success(`${(node.data as { label?: string }).label} imported`);
    },
    [
      session,
      edges,
      setNodes,
      setEdges,
      takeSnapshot,
      currentEnvId,
      resetBaseline,
      canvasVersionRef,
    ],
  );

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      setMenu({
        x: "clientX" in event ? event.clientX : (event as any).clientX,
        y: "clientY" in event ? event.clientY : (event as any).clientY,
      });
    },
    [],
  );

  const { onAddNodes } = useAiCanvasUpdate({
    nodes,
    isRunning,
    setNodes,
    setEdges,
    takeSnapshot,
    fitView,
  });

  const handleApplyTemplate = useCallback(
    (templateName: string) => {
      const canvas = buildTemplateCanvas(templateName);
      if (!canvas) return;
      takeSnapshot();
      setNodes(canvas.nodes as Node[]);
      setEdges(canvas.edges as Edge[]);
      setTimeout(() => fitView({ duration: 600, padding: 0.25 }), 80);
    },
    [setNodes, setEdges, takeSnapshot, fitView],
  );

  const onUpdateNode = useCallback(
    (id: string, data: any) => {
      setNodes((nds: Node[]) =>
        nds.map((node: Node) => {
          if (node.id === id) {
            return { ...node, data: { ...node.data, ...data } };
          }
          return node;
        }),
      );
    },
    [setNodes],
  );

  useOnSelectionChange({
    onChange: ({ nodes: selectedNodes }) => {
      setSelectedNodesArray(selectedNodes);
      if (selectedNodes.length === 1) {
        setSelectedNode(selectedNodes[0]);
      } else {
        setSelectedNode(null);
      }
    },
  });

  const { onConnect, handleEdgesChange } = useCanvasEdges({
    nodes,
    edges,
    isRunning,
    setEdges,
    setNodes,
    setDeployLogs,
    takeSnapshot,
    onEdgesChange,
    onUpdateNode,
    projectId: projectId !== "new" ? projectId : undefined,
    session,
  });

  const { connectedGithub, connectedResend } = useSelectedNodeRelations(
    selectedNode,
    nodes,
    edges,
  );

  useUsageMonitoring({
    workflowId: projectId,
    nodes,
    session,
    setNodes,
    enabled: isCloud,
  });
  useDriftMonitoring({
    workflowId: projectId,
    nodes,
    session,
    setNodes,
  });
  useIncidentMonitoring({
    workflowId: projectId,
    nodes,
    session,
    setNodes,
    enabled: isCloud,
  });

  // First-edge hint: show once when user draws their first connection
  const firstEdgeShownRef = useRef(
    typeof localStorage !== "undefined" &&
      localStorage.getItem("leenar_first_edge_hint") === "1",
  );
  useEffect(() => {
    if (firstEdgeShownRef.current || edges.length === 0) return;
    firstEdgeShownRef.current = true;
    localStorage.setItem("leenar_first_edge_hint", "1");
    toast.success(
      "Services connected — env vars will be auto-injected between them. No copy-pasting needed.",
      { duration: 6000 },
    );
  }, [edges.length]);

  useEffect(() => {
    const handler = () => setShowDriftModal(true);
    window.addEventListener("leenar:open-drifts", handler);
    return () => window.removeEventListener("leenar:open-drifts", handler);
  }, []);

  const { handleGroupNodes, onNodeDragStop } = useNodeGrouping({
    selectedNodesArray,
    setSelectedNodesArray,
    setNodes,
    takeSnapshot,
    menu,
    setMenu,
    screenToFlowPosition,
    getInternalNode,
  });

  // Calm toolbar: advanced controls (env switcher, terminal, undo/redo) stay
  // hidden until the project's first successful deploy. Sourced directly from
  // the real project status (useWorkflowPersistence surfaces `wf.status` from
  // getProject) rather than a node-provisioned heuristic — a node can be
  // marked "provisioned" by importing an existing resource (MCP import_node)
  // without ever deploying, which would falsely flip a draft project "live".
  const serviceNodes = nodes.filter((n) => n.type === "service");
  const isLive = workflowStatus === "active";

  // Existing deploy-gating condition (see PreDeployModal, which toasts
  // "Add at least one service to the canvas before deploying." and closes
  // itself when opened with zero services). Surfaced here as a muted line so
  // the reason is visible before the user even opens the modal.
  const deployDisabledReason =
    !isRunning && serviceNodes.length === 0
      ? "Add a service to the canvas to deploy"
      : null;

  return (
    <div
      className="app-shell bg-background text-foreground flex h-full w-full overflow-hidden font-sans select-none text-[12px]"
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => setMenu(null)}
    >
      <div className="flex-1 flex flex-col relative h-full min-w-0 overflow-hidden">
        <ComponentErrorBoundary name="Canvas">
          <div data-tour="canvas" className="flex-1 relative overflow-hidden">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onNodeDragStop={onNodeDragStop}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onPaneContextMenu={onPaneContextMenu}
              proOptions={{ hideAttribution: true }}
              onBeforeDelete={handleBeforeDelete}
              onNodeClick={(_e: React.MouseEvent, node: Node) => {
                setSelectedNode(node);
                setSelectedEdge(null);
                setIsSidebarOpen(true);
              }}
              onNodeDoubleClick={(_e: React.MouseEvent, node: Node) => {
                setSelectedNode(node);
                setSelectedEdge(null);
                setIsSidebarOpen(true);
              }}
              onEdgeClick={(_e: React.MouseEvent, edge: Edge) => {
                setSelectedEdge(edge);
                setSelectedNode(null);
                setIsSidebarOpen(false);
              }}
              onPaneClick={() => {
                setSelectedNode(null);
                setSelectedEdge(null);
                setIsSidebarOpen(false);
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              // The dock floats over the bottom of the canvas now, so the
              // initial fit has to leave it room.
              fitViewOptions={{ padding: 0.2 }}
              colorMode={colorMode}
              className="bg-[var(--canvas-bg)]"
              connectOnClick
              connectionMode={ConnectionMode.Loose}
              selectionOnDrag={true}
              selectionMode={SelectionMode.Full}
              panOnDrag={[1, 2]}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background color="var(--dot)" gap={26} size={1} aria-hidden />
              <Controls
                className="!bottom-24 !left-6 overflow-hidden !rounded-xl !border !border-border-soft !bg-[var(--glass)] !shadow-[var(--raise-lg)] backdrop-blur-xl [&_button]:!border-0 [&_button]:!border-b [&_button]:!border-border-soft [&_button]:!bg-transparent [&_button]:!fill-current [&_button]:!text-muted-foreground [&_button:hover]:!bg-[var(--hover)] [&_button:hover]:!text-foreground"
                showInteractive={false}
              />

              <AnimatePresence>
                {isTerminalOpen && (
                  <TerminalConsole
                    onClose={() => setIsTerminalOpen(false)}
                    isRunning={isRunning}
                    externalLogs={deployLogs}
                    stackId={completedStackId}
                    stepCount={deployStepCount}
                  />
                )}
              </AnimatePresence>
            </ReactFlow>

            {/* The dock and the top-left project cluster position
                themselves absolutely, so they sit inside the canvas's
                relative wrapper rather than reserving 48px above it. */}
            <Toolbar
              workflowId={projectId !== "new" ? projectId : undefined}
              isRunning={isRunning}
              hasDeployError={deployError}
              onRunToggle={
                isRunning ? handleDeployToggle : () => setShowPreDeploy(true)
              }
              workflowName={workflowName}
              onRename={handleRename}
              onExport={handleExport}
              onImport={handleCanvasImport}
              onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
              isTerminalOpen={isTerminalOpen}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              saveState={saveState}
              onAutoLayout={handleAutoLayout}
              onShowShortcuts={() => setShowShortcuts(true)}
              onScreenshot={nodes.length > 0 ? handleScreenshot : undefined}
              onAddNode={onAddNode}
              environments={environments}
              currentEnvId={currentEnvId}
              onEnvSwitch={handleEnvSwitch}
              onEnvManage={() => setShowEnvManage(true)}
              onImportExisting={() => setShowScanModal(true)}
              showAdvanced={isLive}
              deployDisabledReason={deployDisabledReason}
            />

            {/* AI diagnosis card — shown after deploy failure */}
            <AnimatePresence>
              {deployError && (aiSuggestionLoading || aiSuggestion) && (
                <AiDiagnosisCard
                  aiSuggestion={aiSuggestion}
                  aiSuggestionLoading={aiSuggestionLoading}
                  deployErrorMsg={deployErrorMsg}
                  onConnectService={connectService}
                />
              )}
            </AnimatePresence>

            {menu && (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                onAddNode={onAddNode}
                onClose={() => setMenu(null)}
              />
            )}

            {/* Empty canvas hint — shown only when no service nodes exist */}
            {nodes.filter((n) => n.type === "service").length === 0 &&
              !isRunning &&
              canSaveRef.current && (
                <EmptyCanvasHint
                  onPrefill={(text) => {
                    window.dispatchEvent(
                      new CustomEvent("leenar:chat-prefill", {
                        detail: { text },
                      }),
                    );
                    setIsSidebarOpen(true);
                  }}
                  onImportExisting={() => setShowScanModal(true)}
                />
              )}
            <ComponentErrorBoundary name="EdgeEditor">
              <AnimatePresence>
                {selectedEdge &&
                  (() => {
                    const srcNode = nodes.find(
                      (n) => n.id === selectedEdge.source,
                    );
                    const tgtNode = nodes.find(
                      (n) => n.id === selectedEdge.target,
                    );
                    const srcLabel =
                      (srcNode?.data as any)?.label ?? selectedEdge.source;
                    const tgtLabel =
                      (tgtNode?.data as any)?.label ?? selectedEdge.target;
                    const fromSvc = srcNode
                      ? inferServiceType(
                          srcNode.data as Record<string, unknown>,
                        )
                      : null;
                    const toSvc = tgtNode
                      ? inferServiceType(
                          tgtNode.data as Record<string, unknown>,
                        )
                      : null;
                    // Resolve base names to the prefixed forms shown as the
                    // editor default (shotgun — target framework is unknown in
                    // the canvas). An explicit user edit becomes an override.
                    const defaultEnvVars: string[] =
                      fromSvc && toSvc
                        ? resolveEnvKeys(
                            ENV_FLOW[fromSvc]?.[toSvc] ?? [],
                            toSvc,
                          )
                        : [];
                    return (
                      <EdgeEditor
                        key={selectedEdge.id}
                        edge={selectedEdge}
                        sourceLabel={srcLabel}
                        targetLabel={tgtLabel}
                        defaultEnvVars={defaultEnvVars}
                        onChange={(envVars) => {
                          setEdges((eds: Edge[]) =>
                            eds.map((e: Edge) =>
                              e.id === selectedEdge.id
                                ? {
                                    ...e,
                                    data: {
                                      ...(e.data ?? {}),
                                      envVars,
                                      synced: false,
                                    },
                                  }
                                : e,
                            ),
                          );
                          setSelectedEdge((prev) =>
                            prev?.id === selectedEdge.id
                              ? {
                                  ...prev,
                                  data: {
                                    ...(prev.data ?? {}),
                                    envVars,
                                    synced: false,
                                  },
                                }
                              : prev,
                          );
                        }}
                        onClose={() => setSelectedEdge(null)}
                      />
                    );
                  })()}
              </AnimatePresence>
            </ComponentErrorBoundary>
            <ComponentErrorBoundary name="ServiceDrawer">
              <AnimatePresence>
                {isSidebarOpen && selectedNode && (
                  <ServiceDrawer
                    key={selectedNode.id}
                    node={selectedNode}
                    onClose={() => {
                      setIsSidebarOpen(false);
                      setSelectedNode(null);
                    }}
                    onUpdateNode={onUpdateNode}
                    onImportNode={handleImportNode}
                    onResendDomains={
                      session ? () => getResendDomains(session) : undefined
                    }
                    onGitHubRepos={
                      session ? () => getGitHubRepos(session) : undefined
                    }
                    onVercelDomains={
                      session && selectedNode?.data?.vercelProjectId
                        ? () =>
                            listVercelDomains(
                              selectedNode.data.vercelProjectId as string,
                              session,
                            )
                        : undefined
                    }
                    onAddVercelDomain={
                      session && selectedNode?.data?.vercelProjectId
                        ? (domain) =>
                            addVercelDomain(
                              selectedNode.data.vercelProjectId as string,
                              domain,
                              session,
                            )
                        : undefined
                    }
                    onRemoveVercelDomain={
                      session && selectedNode?.data?.vercelProjectId
                        ? (domain) =>
                            removeVercelDomain(
                              selectedNode.data.vercelProjectId as string,
                              domain,
                              session,
                            )
                        : undefined
                    }
                    onAddCfDns={
                      session && selectedNode?.data?.vercelProjectId
                        ? (domain) =>
                            addCfDnsForVercelDomain(
                              selectedNode.data.vercelProjectId as string,
                              domain,
                              session,
                            )
                        : undefined
                    }
                    onCreateResendDomain={
                      session
                        ? (name) => createResendDomain(name, session)
                        : undefined
                    }
                    onResendDomainRecords={
                      session
                        ? (id) => getResendDomainRecords(id, session)
                        : undefined
                    }
                    onDeleteResendDomain={
                      session
                        ? (id) => deleteResendDomain(id, session)
                        : undefined
                    }
                    connectedGithub={connectedGithub}
                    connectedResend={connectedResend}
                    workflowId={projectId !== "new" ? projectId : undefined}
                    projectId={projectId !== "new" ? projectId : undefined}
                    currentEnvId={currentEnvId}
                    session={session}
                    onRedeploy={handleNodeRedeploy}
                  />
                )}
              </AnimatePresence>
            </ComponentErrorBoundary>
          </div>
        </ComponentErrorBoundary>
      </div>
      <ComponentErrorBoundary name="ChatPanel">
        <ChatPanel
          nodes={nodes.map((n) => ({
            id: n.id,
            type: n.type ?? "unknown",
            data: n.data as Record<string, unknown>,
          }))}
          edges={edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: e.data as any,
          }))}
          onAddNodes={onAddNodes}
          workflowId={currentWorkflowId}
          workflowName={workflowName}
          initialMessages={initialChatMessages}
          onDeploy={() => setShowPreDeploy(true)}
          onApplyTemplate={handleApplyTemplate}
          isDeploying={isRunning}
          deployLogs={deployLogs}
          currentEnvName={environments.find((e) => e.id === currentEnvId)?.name}
          currentEnvIsDefault={
            environments.find((e) => e.id === currentEnvId)?.is_default
          }
          environments={environments}
        />
      </ComponentErrorBoundary>

      <AnimatePresence>
        {deletionTarget && (
          <NodeDeletionModal
            node={deletionTarget}
            onConfirm={handleDeletionConfirm}
            onCancel={handleDeletionCancel}
            isDeprovisioning={isDeprovisioning}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {integrationBanner?.type === "missing" && (
          <IntegrationBanner
            banner={integrationBanner}
            onClose={() => setIntegrationBanner(null)}
            onConnect={connectService}
          />
        )}
        {integrationBanner?.type === "vercel_github" && (
          <VercelGitHubBanner
            reason={integrationBanner.reason}
            vercelHasGitHub={integrationBanner.vercelHasGitHub}
            githubHasVercel={integrationBanner.githubHasVercel}
            onClose={() => setIntegrationBanner(null)}
            onRetry={handleDeployToggle}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSuccessModal && (
          <DeploySuccessModal
            services={successServices}
            stackId={completedStackId}
            workflowId={workflowIdRef.current}
            workflowName={workflowName}
            session={session}
            onClose={() => setShowSuccessModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShortcuts && (
          <ShortcutsModal onClose={() => setShowShortcuts(false)} />
        )}
      </AnimatePresence>

      {showEnvManage && session && (
        <EnvManageModal
          workflowId={projectId}
          environments={environments}
          currentEnvId={currentEnvId}
          session={session}
          onClose={() => setShowEnvManage(false)}
          onEnvsChange={setEnvironments}
          onSwitchEnv={handleEnvSwitch}
        />
      )}

      <AnimatePresence>
        {showPreDeploy && (
          <PreDeployModal
            nodes={nodes}
            edges={edges}
            onConfirm={() => {
              setShowPreDeploy(false);
              handleDeployToggle();
            }}
            onClose={() => setShowPreDeploy(false)}
            targetEnvName={
              environments.find((e) => e.id === currentEnvId)?.name ?? null
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDriftModal && session && (
          <DriftReviewModal
            workflowId={projectId}
            session={session}
            onClose={() => setShowDriftModal(false)}
            onNodeDriftCountChange={(nodeId, newCount) => {
              // driftCount is a runtime-only field; authoringKey ignores it, so
              // this display update never triggers an auto-save.
              setNodes((nds: Node[]) =>
                nds.map((n: Node) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, driftCount: newCount } }
                    : n,
                ),
              );
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScanModal && session && (
          <ScanAccountsModal
            session={session}
            onClose={() => setShowScanModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface ProjectCanvasProps {
  projectId?: string;
  template?: string;
}

export function ProjectCanvas({
  projectId = "new",
  template,
}: ProjectCanvasProps) {
  return (
    <ReactFlowProvider>
      <ProjectCanvasInner projectId={projectId} template={template} />
    </ReactFlowProvider>
  );
}
