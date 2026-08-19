import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import { Rows, Row } from "../components/console/Rows";
import { readThemePref, setTheme, type ThemePref } from "../lib/theme";

export const Route = createFileRoute("/console/settings/appearance")({
  component: AppearancePage,
  head: () => ({ meta: [{ title: "Appearance — Leenar Console" }] }),
});

/**
 * Literal values, deliberately: a swatch painted with --background would
 * render the theme you are already in, three times over. These are the
 * ground/panel/ink of each theme as defined in styles.css. System shows
 * both halves because that is what it means.
 */
const SWATCH: Record<ThemePref, { bg: string; panel: string; ink: string }> = {
  system: { bg: "#0a0a0b", panel: "#f2f2f0", ink: "#8a8a88" },
  light: { bg: "#f2f2f0", panel: "#fafaf9", ink: "#16161a" },
  dark: { bg: "#0a0a0b", panel: "#141416", ink: "#ececea" },
};

const options: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "system", label: "System", icon: Monitor },
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
];

function Swatch({ pref }: { pref: ThemePref }) {
  const s = SWATCH[pref];
  return (
    <span
      aria-hidden
      className="flex h-7 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border"
      style={{ background: s.bg }}
    >
      {/* The inner panel carries its own hairline: on the light theme a
          #fafaf9 panel on a #f2f2f0 ground is a 1.03:1 edge, so without it
          the light swatch reads as a blank pill. */}
      <span
        className="flex h-4 w-7 items-center justify-start rounded-[3px] px-1"
        style={{ background: s.panel, border: `1px solid ${s.ink}33` }}
      >
        <span
          className="h-[2px] w-4 rounded-full"
          style={{ background: s.ink }}
        />
      </span>
    </span>
  );
}

function AppearancePage() {
  const [pref, setPref] = useState<ThemePref>("dark");

  useEffect(() => {
    setPref(readThemePref());
  }, []);

  const choose = (next: ThemePref) => {
    setPref(next);
    setTheme(next);
  };

  return (
    <SettingsShell title="Appearance">
      <div className="max-w-2xl flex-1 p-5 sm:p-8">
        <SettingsHeader subtitle="Choose how Leenar looks on this device." />
        <div className="mt-4">
          <Rows>
            {options.map((o) => {
              const Icon = o.icon;
              const active = pref === o.key;
              return (
                <Row
                  key={o.key}
                  onClick={() => choose(o.key)}
                  className="cursor-pointer"
                >
                  <Swatch pref={o.key} />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {/* No hue on the tick: a selected option is a selection,
                      not a state (spec D3). */}
                  <span className="flex-1">{o.label}</span>
                  {active && <Check className="h-4 w-4" />}
                </Row>
              );
            })}
          </Rows>
        </div>
      </div>
    </SettingsShell>
  );
}
