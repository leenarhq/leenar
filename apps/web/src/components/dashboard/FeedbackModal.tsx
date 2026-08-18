import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { useAuth } from "../../context/auth";
import { supabase } from "../../lib/supabase";

export function FeedbackModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");

  const submit = async () => {
    const text = message.trim();
    if (!text || !user) return;
    setStatus("submitting");
    const { error } = await supabase.from("user_feedback").insert({
      user_id: user.id,
      message: text,
      page: window.location.pathname,
    });
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("done");
    setTimeout(() => {
      onOpenChange(false);
      setMessage("");
      setStatus("idle");
    }, 1200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
        </DialogHeader>

        {status === "done" ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Thanks for your feedback!
          </p>
        ) : status === "error" ? (
          <>
            <p className="py-4 text-center text-[13px] text-crit">
              Couldn't send feedback. Please try again.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="w-full rounded-full border border-border-soft px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-secondary"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <Textarea
              placeholder="What's on your mind? Bug, idea, anything…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              autoFocus
              className="min-h-[120px] resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tabular-nums text-dim">
                {message.length}/2000
              </span>
              <button
                onClick={submit}
                disabled={!message.trim() || status === "submitting"}
                className="rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {status === "submitting" ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
