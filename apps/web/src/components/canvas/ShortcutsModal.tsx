import { useEffect } from "react";
import { motion } from "framer-motion";

interface ShortcutsModalProps {
  onClose: () => void;
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const groups = [
    {
      label: "History",
      items: [
        { keys: ["⌘", "Z"], desc: "Undo" },
        { keys: ["⌘", "⇧", "Z"], desc: "Redo" },
      ],
    },
    {
      label: "Canvas",
      items: [
        { keys: ["⌘", "C"], desc: "Copy selected nodes" },
        { keys: ["⌘", "V"], desc: "Paste nodes" },
        { keys: ["Del"], desc: "Delete selected" },
        { keys: ["Esc"], desc: "Deselect all" },
        { keys: ["⌘", "A"], desc: "Select all" },
        { keys: ["⌘", "⇧", "F"], desc: "Fit to screen" },
      ],
    },
    {
      label: "Interface",
      items: [
        { keys: ["⌘", "/"], desc: "This overlay" },
        { keys: ["?"], desc: "This overlay" },
      ],
    },
  ] as const;

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        className="relative z-10 w-80 rounded-2xl border border-border-soft p-5 shadow-[var(--raise-lg)]"
        style={{ background: "var(--popover)" }}
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-dim hover:text-foreground hover:bg-secondary transition-all"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="text-[11px] font-mono lowercase text-dim mb-2">
                {g.label}
              </p>
              <div className="space-y-1">
                {g.items.map((item) => (
                  <div
                    key={item.desc}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-[14px] text-muted-foreground">
                      {item.desc}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="px-1.5 py-0.5 rounded text-[12px] font-mono font-semibold text-muted-foreground border border-border bg-[var(--hover)] leading-none"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
