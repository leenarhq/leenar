import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RequestAccessModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) return;
    setStatus("submitting");
    try {
      const res = await fetch(`${API_URL}/api/access-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const reset = () => {
    onOpenChange(false);
    setTimeout(() => {
      setEmail("");
      setStatus("idle");
    }, 200);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(next) : reset())}
    >
      <DialogContent className="border-dashed sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request access</DialogTitle>
        </DialogHeader>

        {status === "done" ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Request received — we'll be in touch soon.
          </p>
        ) : status === "error" ? (
          <>
            <p className="py-4 text-center text-sm text-destructive">
              Couldn't send your request. Please try again.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="w-full rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary/50"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Leave your email and we'll send you an invite.
            </p>
            <Input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
              className="border-dashed"
            />
            <div className="flex justify-end">
              <button
                onClick={submit}
                disabled={
                  !EMAIL_RE.test(email.trim()) || status === "submitting"
                }
                className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {status === "submitting" ? "Sending…" : "Request access"}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
