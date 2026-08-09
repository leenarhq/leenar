import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/auth";

const STORAGE_KEY = "leenar_welcome_v1";

const HOW_IT_WORKS = [
  {
    icon: "⬡",
    title: "Open a Workflow",
    desc: "Think of a workflow as a whiteboard. Each one holds the blueprint of a cloud stack you're building.",
    rgb: "255,255,255",
  },
  {
    icon: "✦",
    title: "Describe to the AI",
    desc: 'Type in plain English — like "I want a Next.js app with user login and a database." AI builds the canvas for you.',
    rgb: "59,130,246",
  },
  {
    icon: "⊞",
    title: "Connect & configure",
    desc: "Click any service box to set its name, domain, or region. Draw lines between services to wire them together.",
    rgb: "168,85,247",
  },
  {
    icon: "↗",
    title: "Deploy with one click",
    desc: "Hit Deploy. Leenar creates every service in the correct order and connects them automatically.",
    rgb: "34,197,94",
  },
];

const PATHS = [
  {
    id: "ai",
    icon: "✦",
    title: "Build with AI",
    desc: "Describe your project and let the AI set up the canvas. Best for getting started fast.",
    cta: "Start building →",
    rgb: "59,130,246",
  },
  {
    id: "template",
    icon: "⬡",
    title: "Use a template",
    desc: "Pick a ready-made stack like Next.js + Supabase and customize it to your needs.",
    cta: "Browse templates →",
    rgb: "168,85,247",
  },
  {
    id: "explore",
    icon: "⊞",
    title: "Explore on my own",
    desc: "Open an empty canvas and discover features at your own pace.",
    cta: "Open canvas →",
    rgb: "255,255,255",
  },
];

interface Props {
  firstName: string;
  onCreateWorkflow: () => void;
}

export function WelcomeModal({ firstName, onCreateWorkflow }: Props) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const TOTAL = 3;

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (!session) return;
    const meta = session.user.user_metadata;
    if (
      meta?.welcome_seen ||
      meta?.onboarding_complete ||
      meta?.canvas_tour_done_v2
    ) {
      localStorage.setItem(STORAGE_KEY, "1");
      return;
    }
    const t = setTimeout(() => setActive(true), 500);
    return () => clearTimeout(t);
  }, [session]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setActive(false);
    supabase.auth.updateUser({ data: { welcome_seen: true } }).catch(() => {});
  };

  const handlePath = (id: string) => {
    dismiss();
    if (id === "template") {
      setTimeout(() => navigate({ to: "/console/templates" }), 280);
    } else if (id === "ai") {
      setTimeout(() => navigate({ to: "/console/new" }), 280);
    } else {
      setTimeout(() => onCreateWorkflow(), 280);
    }
  };

  if (!active) return null;

  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          key="wb"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.84)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "Geist, sans-serif",
          }}
        >
          <motion.div
            key="wc"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{
              duration: 0.38,
              ease: [0.22, 1, 0.36, 1],
              delay: 0.04,
            }}
            style={{
              background: "#090909",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 24,
              width: "100%",
              maxWidth: step === 2 ? 640 : 520,
              boxShadow:
                "0 48px 120px rgba(0,0,0,0.85), 0 0 0 1px rgba(59,130,246,0.05)",
              overflow: "hidden",
              transition: "max-width 0.3s ease",
            }}
          >
            {/* Top progress bar */}
            <div style={{ height: 2, background: "rgba(255,255,255,0.04)" }}>
              <div
                style={{
                  height: "100%",
                  background: "linear-gradient(90deg, #3b82f6, #818cf8)",
                  width: `${((step + 1) / TOTAL) * 100}%`,
                  transition: "width 0.4s ease",
                  borderRadius: "0 999px 999px 0",
                }}
              />
            </div>

            <div style={{ padding: "34px 40px 32px" }}>
              {/* Step dots */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginBottom: 30,
                }}
              >
                {Array.from({ length: TOTAL }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: i === step ? 22 : 5,
                      height: 5,
                      borderRadius: 999,
                      background:
                        i === step
                          ? "#3b82f6"
                          : i < step
                            ? "rgba(59,130,246,0.35)"
                            : "rgba(255,255,255,0.07)",
                      transition: "all 0.25s ease",
                    }}
                  />
                ))}
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    color: "rgba(255,255,255,0.2)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {step + 1} / {TOTAL}
                </span>
              </div>

              {/* Step content */}
              <AnimatePresence mode="wait">
                {step === 0 && (
                  <motion.div
                    key="s0"
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Intro */}
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        background: "rgba(59,130,246,0.08)",
                        border: "1px solid rgba(59,130,246,0.18)",
                        borderRadius: 999,
                        padding: "4px 12px",
                        marginBottom: 20,
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: "#3b82f6",
                          display: "inline-block",
                          boxShadow: "0 0 6px rgba(59,130,246,0.8)",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: "rgba(96,165,250,0.9)",
                          letterSpacing: "0.07em",
                          textTransform: "uppercase",
                        }}
                      >
                        Welcome
                      </span>
                    </div>

                    <h1
                      style={{
                        fontSize: 26,
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.93)",
                        letterSpacing: "-0.03em",
                        lineHeight: 1.2,
                        marginBottom: 10,
                      }}
                    >
                      Hey {firstName !== "there" ? firstName : "there"}, welcome
                      to Leenar
                    </h1>
                    <p
                      style={{
                        fontSize: 14,
                        color: "rgba(255,255,255,0.38)",
                        lineHeight: 1.65,
                        marginBottom: 30,
                      }}
                    >
                      Leenar lets you design and deploy full cloud stacks
                      visually — no terminal commands, no YAML files, no
                      copy-pasting secret keys.
                    </p>

                    {/* 3-concept visual */}
                    <div
                      style={{
                        display: "flex",
                        borderRadius: 14,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.02)",
                        marginBottom: 22,
                      }}
                    >
                      {[
                        {
                          icon: "✦",
                          label: "Describe",
                          sub: "Tell AI what to build",
                          rgb: "59,130,246",
                        },
                        {
                          icon: "⬡",
                          label: "Design",
                          sub: "Visual canvas editor",
                          rgb: "168,85,247",
                        },
                        {
                          icon: "↗",
                          label: "Deploy",
                          sub: "One click — everything",
                          rgb: "34,197,94",
                        },
                      ].map((c, i) => (
                        <div
                          key={c.label}
                          style={{
                            flex: 1,
                            padding: "18px 12px",
                            textAlign: "center",
                            borderRight:
                              i < 2
                                ? "1px solid rgba(255,255,255,0.05)"
                                : "none",
                          }}
                        >
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 9,
                              margin: "0 auto 10px",
                              background: `rgba(${c.rgb},0.1)`,
                              border: `1px solid rgba(${c.rgb},0.2)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              color: `rgba(${c.rgb},0.9)`,
                            }}
                          >
                            {c.icon}
                          </div>
                          <p
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: "rgba(255,255,255,0.72)",
                              marginBottom: 3,
                            }}
                          >
                            {c.label}
                          </p>
                          <p
                            style={{
                              fontSize: 10.5,
                              color: "rgba(255,255,255,0.26)",
                              lineHeight: 1.4,
                            }}
                          >
                            {c.sub}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Time pill */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "9px 14px",
                        borderRadius: 10,
                        background: "rgba(34,197,94,0.04)",
                        border: "1px solid rgba(34,197,94,0.1)",
                        marginBottom: 26,
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="rgba(74,222,128,0.65)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <p
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.35)",
                        }}
                      >
                        Most teams deploy their first stack in{" "}
                        <strong style={{ color: "rgba(74,222,128,0.7)" }}>
                          under 10 minutes
                        </strong>
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={() => setStep(1)}
                        style={{
                          flex: 1,
                          padding: "12px 20px",
                          background: "#3b82f6",
                          border: "none",
                          borderRadius: 11,
                          color: "#fff",
                          fontSize: 13.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "#2563eb")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "#3b82f6")
                        }
                      >
                        Show me how it works →
                      </button>
                      <button
                        onClick={dismiss}
                        style={{
                          padding: "12px 16px",
                          background: "none",
                          border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: 11,
                          color: "rgba(255,255,255,0.22)",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Skip
                      </button>
                    </div>
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div
                    key="s1"
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* How it works */}
                    <h2
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.9)",
                        letterSpacing: "-0.025em",
                        marginBottom: 8,
                      }}
                    >
                      Here's the simple flow
                    </h2>
                    <p
                      style={{
                        fontSize: 13.5,
                        color: "rgba(255,255,255,0.35)",
                        lineHeight: 1.55,
                        marginBottom: 26,
                      }}
                    >
                      Four steps from idea to live cloud infrastructure.
                    </p>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        marginBottom: 28,
                      }}
                    >
                      {HOW_IT_WORKS.map((item, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 14,
                            padding: "14px 16px",
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            borderRadius: 12,
                          }}
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              flexShrink: 0,
                              background: `rgba(${item.rgb},0.1)`,
                              border: `1px solid rgba(${item.rgb},0.18)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              color: `rgba(${item.rgb},0.85)`,
                            }}
                          >
                            {item.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 3,
                              }}
                            >
                              <p
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  color: "rgba(255,255,255,0.8)",
                                  letterSpacing: "-0.01em",
                                }}
                              >
                                {item.title}
                              </p>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "rgba(255,255,255,0.18)",
                                  letterSpacing: "0.06em",
                                  background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.07)",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                }}
                              >
                                STEP {i + 1}
                              </span>
                            </div>
                            <p
                              style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.36)",
                                lineHeight: 1.55,
                              }}
                            >
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={() => setStep(0)}
                        style={{
                          padding: "11px 16px",
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: 11,
                          color: "rgba(255,255,255,0.35)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ← Back
                      </button>
                      <button
                        onClick={() => setStep(2)}
                        style={{
                          flex: 1,
                          padding: "11px 20px",
                          background: "#3b82f6",
                          border: "none",
                          borderRadius: 11,
                          color: "#fff",
                          fontSize: 13.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "#2563eb")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "#3b82f6")
                        }
                      >
                        Choose how to start →
                      </button>
                    </div>
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div
                    key="s2"
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Choose path */}
                    <h2
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.9)",
                        letterSpacing: "-0.025em",
                        marginBottom: 8,
                      }}
                    >
                      How would you like to start?
                    </h2>
                    <p
                      style={{
                        fontSize: 13.5,
                        color: "rgba(255,255,255,0.35)",
                        marginBottom: 22,
                      }}
                    >
                      You can always change your mind later.
                    </p>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        marginBottom: 22,
                      }}
                    >
                      {PATHS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handlePath(p.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "14px 16px",
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            borderRadius: 12,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textAlign: "left",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              "rgba(255,255,255,0.05)";
                            e.currentTarget.style.borderColor = `rgba(${p.rgb},0.3)`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background =
                              "rgba(255,255,255,0.025)";
                            e.currentTarget.style.borderColor =
                              "rgba(255,255,255,0.07)";
                          }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 9,
                              flexShrink: 0,
                              background: `rgba(${p.rgb},0.1)`,
                              border: `1px solid rgba(${p.rgb},0.2)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              color: `rgba(${p.rgb},0.85)`,
                            }}
                          >
                            {p.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "rgba(255,255,255,0.8)",
                                marginBottom: 3,
                                letterSpacing: "-0.01em",
                              }}
                            >
                              {p.title}
                            </p>
                            <p
                              style={{
                                fontSize: 11.5,
                                color: "rgba(255,255,255,0.32)",
                                lineHeight: 1.45,
                              }}
                            >
                              {p.desc}
                            </p>
                          </div>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: `rgba(${p.rgb},0.7)`,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {p.cta}
                          </span>
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => setStep(1)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(255,255,255,0.2)",
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        padding: 0,
                      }}
                    >
                      ← Back
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
