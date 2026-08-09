import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";

export const Route = createFileRoute("/console/settings/appearance")({
  component: AppearancePage,
  head: () => ({ meta: [{ title: "Appearance — Leenar Console" }] }),
});

type ThemePref = "system" | "light" | "dark";

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const prefersLight = window.matchMedia(
    "(prefers-color-scheme: light)",
  ).matches;
  const light = pref === "light" || (pref === "system" && prefersLight);
  document.documentElement.classList.toggle("light", light);
}

const options: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "system", label: "System", icon: Monitor },
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
];

function AppearancePage() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    const stored =
      (localStorage.getItem("leenar_theme") as ThemePref | null) ?? "dark";
    setPref(stored);
  }, []);

  const choose = (next: ThemePref) => {
    setPref(next);
    if (next === "system") localStorage.removeItem("leenar_theme");
    else localStorage.setItem("leenar_theme", next);
    applyTheme(next);
  };

  return (
    <SettingsShell title="Appearance">
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Appearance"
          subtitle="Choose how Leenar looks on this device."
        />
        <div className="mt-6 grid grid-cols-3 gap-3">
          {options.map((o) => {
            const Icon = o.icon;
            const active = pref === o.key;
            return (
              <button
                key={o.key}
                onClick={() => choose(o.key)}
                className={`flex flex-col items-center gap-3 rounded-md border p-5 transition-colors ${
                  active
                    ? "border-foreground bg-secondary/40"
                    : "border-border hover:bg-secondary/20"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="flex items-center gap-1.5 text-sm">
                  {o.label}{" "}
                  {active && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingsShell>
  );
}
