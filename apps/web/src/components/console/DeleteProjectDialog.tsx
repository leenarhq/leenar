import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { getProject, type ProjectSummary } from "../../lib/workflows";
import { deleteProjectWithResources } from "../../lib/api";
import { extractCloudResources } from "../../lib/projectResources";

const SERVICE_LABELS: Record<string, string> = {
  vercel: "Vercel",
  supabase: "Supabase",
  "cloudflare-workers": "Cloudflare Worker",
  "cloudflare-r2": "R2 bucket",
};

type Mode = "everything" | "project-only";

export function DeleteProjectDialog({
  project,
  session,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: ProjectSummary;
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<Mode>("everything");
  const [confirmText, setConfirmText] = useState("");

  const resourcesQuery = useQuery({
    queryKey: ["project-resources", project.id],
    queryFn: async () =>
      extractCloudResources((await getProject(project.id)).canvas),
    enabled: open,
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      deleteProjectWithResources(project.id, session, mode === "project-only"),
    onSuccess: (res) => {
      if (res.warnings?.length) {
        toast.warning(
          `Deleted, but some resources may remain: ${res.warnings.join("; ")}`,
        );
      } else {
        toast.success("Project deleted");
      }
      onDeleted();
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to delete project");
    },
  });

  const resources = resourcesQuery.data;
  const hasResources = (resources?.provisioned.length ?? 0) > 0;
  const confirmed = confirmText.trim() === project.name;
  const canDelete = confirmed && !deleteMut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!deleteMut.isPending) onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{project.name}"?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>

        {resourcesQuery.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading resources…
          </div>
        ) : resourcesQuery.isError ? (
          <div className="flex items-start gap-2 py-1 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Couldn't load this project's cloud resources. You can still choose
            below.
          </div>
        ) : null}

        {hasResources ? (
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="gap-3"
          >
            <label className="flex cursor-pointer items-start gap-3">
              <RadioGroupItem value="everything" className="mt-1" />
              <span className="text-sm">
                <span className="font-medium">Delete everything</span>
                <span className="block text-muted-foreground">
                  Project + all cloud resources
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <RadioGroupItem value="project-only" className="mt-1" />
              <span className="text-sm">
                <span className="font-medium">Delete project only</span>
                <span className="block text-muted-foreground">
                  Keep cloud resources running
                </span>
              </span>
            </label>
          </RadioGroup>
        ) : resources ? (
          <p className="text-sm text-muted-foreground">
            No cloud resources — this only removes the project record.
          </p>
        ) : null}

        {hasResources && resources ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            {mode === "everything" ? (
              <>
                <p className="mb-1 font-medium text-destructive">
                  Will be destroyed:
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {resources.provisioned.map((r, i) => (
                    <li key={i}>
                      • {SERVICE_LABELS[r.service] ?? r.service}: {r.label}
                    </li>
                  ))}
                </ul>
                {resources.importedCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ({resources.importedCount} imported resource
                    {resources.importedCount === 1 ? "" : "s"} kept)
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                {resources.provisioned.length} cloud resource
                {resources.provisioned.length === 1 ? "" : "s"} will keep
                running.
              </p>
            )}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label className="text-sm text-muted-foreground">
            Type{" "}
            <span className="font-medium text-foreground">{project.name}</span>{" "}
            to confirm:
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
            placeholder={project.name}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleteMut.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => deleteMut.mutate()}
          >
            {deleteMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
