import { Send } from "lucide-react";
import { PILL_ICON } from "../console/Field";

/** Shown only on an empty thread: they are a way in, not a toolbar. */
const OPENERS = [
  "GitHub + Vercel + Supabase",
  "Add email with Resend",
  "Connect my existing repo",
];

/**
 * Everything below the message list: the openers, the quota notice and the
 * input itself.
 *
 * The textarea ref belongs to ChatPanel rather than to this component because
 * three things outside the composer reach for it — the slash-command handler
 * resets its height, `send` clears it, and the canvas empty state focuses it
 * through a window event. A ref owned here would have to be handed back up,
 * which is the same coupling written twice.
 */
export function ChatComposer({
  input,
  setInput,
  onSend,
  onKeyDown,
  onResize,
  textareaRef,
  loading,
  quotaBlocked,
  showOpeners,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onResize: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  loading: boolean;
  quotaBlocked: boolean;
  showOpeners: boolean;
}) {
  return (
    <div className="flex-shrink-0 px-3 pt-2 pb-3 border-t border-border-soft">
      {showOpeners && !quotaBlocked && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {OPENERS.map((hint) => (
            <button
              key={hint}
              onClick={() => {
                setInput(hint);
                textareaRef.current?.focus();
              }}
              className="text-[11.5px] text-muted-foreground hover:text-foreground bg-secondary border border-border-soft hover:border-border rounded-full px-2.5 py-1 transition-colors"
            >
              {hint}
            </button>
          ))}
        </div>
      )}
      {quotaBlocked && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-warn/10 border border-warn/20 text-[12px] text-warn text-center">
          Daily limit reached — resets at midnight UTC
        </div>
      )}
      {/* INPUT's shape, widened to hold a button: rounded-lg on --border, and
          a focus ring rather than a border that darkens. The composer used to
          be the only text field on this surface that announced focus by
          changing colour instead of gaining a ring. */}
      <div className="flex items-end gap-2 rounded-lg border border-border bg-secondary p-1.5 transition-shadow focus-within:ring-1 focus-within:ring-ring">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            onResize();
          }}
          onKeyDown={onKeyDown}
          placeholder={
            quotaBlocked
              ? "Daily limit reached…"
              : "Ask anything, or / for commands…"
          }
          rows={1}
          disabled={loading || quotaBlocked}
          className="flex-1 bg-transparent py-1.5 px-2 text-[13px] text-foreground focus:outline-none resize-none leading-relaxed placeholder:text-dim disabled:opacity-50"
        />
        {/* PILL_ICON, so send is the same object as every other primary
            action in the console rather than a rounded-lg square only this
            panel has. The fill it carries — bg-primary against
            text-primary-foreground — is the pair that cannot go invisible;
            the one it replaced could and did, because --app-accent resolved
            at :root (custom-property substitution happens where the property
            is DECLARED, so .app-shell's --primary never reached it) while
            --app-text-white was #ffffff in dark and var(--foreground) in
            light. Measured: 1.15:1 dark, 1.00:1 light. */}
        <button
          onClick={onSend}
          disabled={!input.trim() || loading || quotaBlocked}
          className={`${PILL_ICON} active:scale-95`}
          aria-label="Send"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
