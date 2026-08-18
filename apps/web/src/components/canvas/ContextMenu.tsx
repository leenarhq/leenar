import React from "react";
import { motion } from "framer-motion";
import { Box } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  onAddNode: (type: string, data?: any) => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, onAddNode, onClose }: ContextMenuProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed z-[100] w-52 bg-popover backdrop-blur-xl border border-border rounded-xl shadow-2xl overflow-hidden p-1.5"
      style={{ top: y, left: x }}
      onMouseLeave={onClose}
    >
      <div className="px-3 py-2 border-b border-border-soft mb-1.5 text-center">
        <span className="text-[11px] text-primary lowercase">Add Node</span>
      </div>

      <div className="space-y-0.5">
        <button
          onClick={() => {
            onAddNode("service", {
              label: "GitHub",
              iconName: "Github",
              provider: "github",
            });
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] rounded-lg transition-all group"
        >
          <Box
            size={14}
            className="group-hover:scale-110 transition-transform text-muted-foreground"
          />
          Add GitHub
        </button>

        <button
          onClick={() => {
            onAddNode("service", {
              label: "Vercel",
              iconName: "Triangle",
              provider: "vercel",
            });
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] rounded-lg transition-all group"
        >
          <Box
            size={14}
            className="group-hover:scale-110 transition-transform text-muted-foreground"
          />
          Add Vercel
        </button>

        <button
          onClick={() => {
            onAddNode("service", {
              label: "Supabase",
              iconName: "Database",
              provider: "supabase",
            });
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] rounded-lg transition-all group"
        >
          <Box
            size={14}
            className="group-hover:scale-110 transition-transform text-muted-foreground"
          />
          Add Supabase
        </button>

        <button
          onClick={() => {
            onAddNode("service", {
              label: "Resend",
              iconName: "Send",
              provider: "resend",
            });
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] rounded-lg transition-all group"
        >
          <Box
            size={14}
            className="group-hover:scale-110 transition-transform text-muted-foreground"
          />
          Add Resend
        </button>

        <button
          onClick={() => {
            onAddNode("service", {
              label: "Cloudflare",
              iconName: "Cloudflare",
              provider: "cloudflare",
            });
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] rounded-lg transition-all group"
        >
          <Box
            size={14}
            className="group-hover:scale-110 transition-transform text-muted-foreground"
          />
          Add Cloudflare
        </button>
      </div>
    </motion.div>
  );
}
