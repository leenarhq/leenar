import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Colour marks state and only state, through --ok / --warn / --crit.
//
// These are built as data rather than written out twice because flat config
// REPLACES a same-named rule instead of merging it: two config objects both
// setting `no-restricted-syntax` means the later one silently switches the
// earlier one off for every file that matches both. That is not hypothetical —
// it is what the first attempt at this config did, and the palette rule stopped
// firing everywhere while still looking present in the file.
const PALETTE =
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}";
const PALETTE_PREFIX =
  "(?:text|bg|border|ring|from|to|via|fill|stroke|decoration|outline)";
const WHITE_PREFIX =
  "(?:text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder)";

const PALETTE_MSG =
  "Use the state tones (text-ok / text-warn / text-crit) or a token. Raw Tailwind palette colours are not part of the console design system.";
const WHITE_MSG =
  "text-white is a literal, not a token — it does not flip with the theme. Use text-foreground / muted-foreground / dim, or bg-secondary.";

/** One selector pair per pattern: className strings are Literals, and the
 *  conditional `${cond ? "a" : "b"}` forms are TemplateElements. */
const banned = (pattern, message) => [
  { selector: `Literal[value=/\\b${pattern}\\b/]`, message },
  { selector: `TemplateElement[value.raw=/\\b${pattern}\\b/]`, message },
];

const PALETTE_RULES = banned(`${PALETTE_PREFIX}-${PALETTE}`, PALETTE_MSG);
const WHITE_RULES = banned(`${WHITE_PREFIX}-white`, WHITE_MSG);

// The landing and blog are a separate design system that does not flip themes,
// so white is a literal there on purpose. They still get the
// palette rule — they have never used it.
const MARKETING = ["src/components/marketing/**", "src/routes/index.tsx"];

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // PRs 1-6 widened this glob directory by directory as each surface was
    // converted. PR 7 converted the last six files, so there is no glob left
    // to write: it covers `src` entirely — the spec's Layer 3 follow-up — and
    // a regression is now a CI failure rather than a review catch.
    //
    // `-white` rides along here rather than in a block of its own, for the
    // reason given above `banned`. Twenty literal `text-white/x` classes sat
    // inside "converted" directories for six PRs because the palette pattern
    // has no `white` branch: the --color-white bridge made them theme-reactive
    // inside the canvas and literal everywhere else, which is how the
    // dashboard agent ended up painting white text on the light theme.
    //
    // `black` is deliberately unrestricted: every hit is a `bg-black/60` modal
    // scrim, and a scrim is dark in both themes by design.
    files: ["src/**/*.{ts,tsx}"],
    ignores: MARKETING,
    rules: {
      "no-restricted-syntax": ["error", ...PALETTE_RULES, ...WHITE_RULES],
    },
  },
  {
    files: MARKETING,
    rules: { "no-restricted-syntax": ["error", ...PALETTE_RULES] },
  },
  eslintPluginPrettier,
);
