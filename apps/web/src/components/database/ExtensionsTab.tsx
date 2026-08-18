import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Puzzle } from "lucide-react";
import { useAuth } from "../../context/auth";
import { fetchExtensions, setExtension } from "../../lib/api";
import type { ExtensionInfo } from "../../lib/databaseTypes";
import { Switch } from "../ui/switch";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";

type ExtensionsTabProps = {
  projectId: string;
  nodeId: string;
};

export function ExtensionsTab({ projectId, nodeId }: ExtensionsTabProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [pendingDisable, setPendingDisable] = useState<ExtensionInfo | null>(
    null,
  );

  const extensionsQuery = useQuery({
    queryKey: ["db-extensions", projectId, nodeId],
    queryFn: () => fetchExtensions(session!, projectId, nodeId),
    enabled: !!session,
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { name: string; enabled: boolean }) =>
      setExtension(session!, projectId, nodeId, vars.name, vars.enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["db-extensions", projectId, nodeId],
      });
    },
  });

  const extensions = extensionsQuery.data?.extensions ?? [];

  const requestToggle = (ext: ExtensionInfo, enabled: boolean) => {
    toggleMutation.reset();
    if (!enabled && ext.installed) {
      setPendingDisable(ext);
      return;
    }
    toggleMutation.mutate({ name: ext.name, enabled });
  };

  const confirmDisable = () => {
    if (!pendingDisable) return;
    toggleMutation.mutate({ name: pendingDisable.name, enabled: false });
    setPendingDisable(null);
  };

  return (
    <div>
      {/* Mutation error banner */}
      {toggleMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {toggleMutation.error instanceof Error
            ? toggleMutation.error.message
            : "Failed to update extension."}
        </div>
      )}

      {/* Loading skeleton */}
      {extensionsQuery.isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-border bg-secondary"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {extensionsQuery.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          Failed to load extensions
          {extensionsQuery.error instanceof Error
            ? `: ${extensionsQuery.error.message}`
            : "."}
        </div>
      )}

      {/* Empty state */}
      {extensionsQuery.isSuccess && extensions.length === 0 && (
        <div className="rounded-xl border border-border py-24 text-center text-sm text-muted-foreground">
          No extensions available.
        </div>
      )}

      {/* Extensions list */}
      {extensionsQuery.isSuccess && extensions.length > 0 && (
        <div className="space-y-2">
          {extensions.map((ext) => (
            <div
              key={ext.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <Puzzle
                  size={14}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-foreground">
                      {ext.name}
                    </span>
                    {ext.installed && (
                      <span className="inline-flex rounded-full border border-ok/20 bg-ok/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ok">
                        {ext.installedVersion
                          ? `v${ext.installedVersion}`
                          : "installed"}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ext.description}
                  </p>
                </div>
              </div>
              <Switch
                checked={ext.installed}
                disabled={toggleMutation.isPending}
                onCheckedChange={(checked) => requestToggle(ext, checked)}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      )}

      {/* Destructive confirm dialog */}
      <AlertDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable extension</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisable &&
                `Disabling "${pendingDisable.name}" will DROP the extension. Any columns/indexes that depend on it may be dropped too. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDisable}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
