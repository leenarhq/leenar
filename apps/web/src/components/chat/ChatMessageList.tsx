import { Sparkles } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import { CanvasUpdateCard } from "./CanvasUpdateCard";
import { ConfirmCard } from "./ConfirmCard";
import type { ParsedMessage } from "./chatTypes";
import type { CanvasUpdatePayload } from "../../lib/api";

/**
 * The thread.
 *
 * Filtering happens here but indices do not: every callback is handed the
 * message's index in the *unfiltered* list, because that index is the key the
 * applied/confirmed/cancelled sets are stored under. Renumbering under a
 * search would silently re-point them at other messages.
 */
export function ChatMessageList({
  messages,
  searchQuery,
  loading,
  canApply,
  appliedUpdates,
  confirmedUpdates,
  cancelledUpdates,
  onApply,
  onConfirm,
  onCancel,
  bottomRef,
}: {
  messages: ParsedMessage[];
  searchQuery: string;
  loading: boolean;
  canApply: boolean;
  appliedUpdates: Set<number>;
  confirmedUpdates: Set<number>;
  cancelledUpdates: Set<number>;
  onApply: (msgIdx: number, update: CanvasUpdatePayload) => void;
  onConfirm: (msgIdx: number, update: CanvasUpdatePayload) => void;
  onCancel: (msgIdx: number) => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/[0.07] border border-primary/[0.12] flex items-center justify-center">
            <Sparkles size={16} className="text-muted-foreground" />
          </div>
          <p className="text-[12px] text-dim text-center leading-relaxed px-4">
            Describe what you want to build.
          </p>
        </div>
      </div>
    );
  }

  const shown = messages
    .map((msg, originalIdx) => ({ msg, originalIdx }))
    .filter(
      ({ msg }) =>
        !searchQuery ||
        msg.content.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
      {shown.map(({ msg, originalIdx }) => (
        <div
          key={originalIdx}
          className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
        >
          {msg.content &&
            (msg.role === "user" ? (
              <div className="max-w-[88%] bg-primary/[0.14] text-foreground rounded-2xl rounded-br-md px-3 py-2.5 text-[13px] leading-relaxed border border-primary/[0.18] shadow-sm">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[97%] w-full">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles size={9} className="text-primary" />
                  </div>
                  <div className="text-[13px] leading-relaxed text-foreground flex-1 min-w-0">
                    <MarkdownContent text={msg.content} />
                  </div>
                </div>
              </div>
            ))}
          {msg.role === "assistant" && msg.canvasUpdate && (
            <div className="w-full max-w-[92%]">
              <CanvasUpdateCard
                update={msg.canvasUpdate}
                onApply={() => onApply(originalIdx, msg.canvasUpdate!)}
                applied={msg.autoApplied || appliedUpdates.has(originalIdx)}
                canApply={canApply}
              />
            </div>
          )}
          {msg.role === "assistant" && msg.pendingUpdate && (
            <div className="w-full max-w-[92%]">
              <ConfirmCard
                update={msg.pendingUpdate}
                onApply={() => onConfirm(originalIdx, msg.pendingUpdate!)}
                onCancel={() => onCancel(originalIdx)}
                applied={confirmedUpdates.has(originalIdx)}
                cancelled={cancelledUpdates.has(originalIdx)}
              />
            </div>
          )}
        </div>
      ))}
      {loading && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2.5 py-2 px-3 rounded-2xl bg-secondary border border-border-soft">
            <div className="w-5 h-5 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <Sparkles size={9} className="text-primary" />
            </div>
            <div className="flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1 h-1 rounded-full bg-dim"
                  style={{ animation: `bounce 1.2s ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
