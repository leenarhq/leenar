import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { ChatPanel } from "../chat/ChatPanel";
import type { Node, Edge } from "@xyflow/react";

interface Props {
  open: boolean;
  onClose: () => void;
  nodes?: Node[];
  edges?: Edge[];
  workflowId?: string;
  workflowName?: string;
  isDeploying?: boolean;
  onDeploy?: () => void;
}

export function ChatPanelSheet({
  open,
  onClose,
  nodes,
  edges,
  workflowId,
  workflowName,
  isDeploying,
  onDeploy,
}: Props) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(2px)",
            }}
          />
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 380 }}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 51,
              height: "82vh",
              borderRadius: "18px 18px 0 0",
              background: "#0c0c0c",
              border: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "none",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px 16px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.15)",
                }}
              />
              <button
                onClick={onClose}
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <ChatPanel
                nodes={nodes as any}
                edges={edges as any}
                workflowId={workflowId}
                workflowName={workflowName}
                isDeploying={isDeploying}
                onDeploy={onDeploy}
                className="w-full"
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
