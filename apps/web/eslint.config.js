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
//
// Because of that, adding a scope means re-checking every rule in every scope.
// Drop a file into each of `src/`, `src/components/marketing/` and
// `src/components/marketing/mock/` holding one line per rule
// (`text-blue-500`, `text-white/80`, `bg-[#3ecf8e]`,
// `style={{ color: "#ef4444" }}`) and confirm this, which is what the blocks
// below are meant to produce:
//
//              palette  -white  arbitrary-hex  inline-literal
//   console       ×        ×          ×              ×
//   marketing     ×        ·          ×              ×
//   mock          ×        ·          ·              ·
const PALETTE =
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}";
const PALETTE_PREFIX =
  "(?:text|bg|border|ring|from|to|via|fill|stroke|decoration|outline)";
const WHITE_PREFIX =
  "(?:text|bg|border|ring|from|to|via|fill|stroke|divide|placeholder)";

// An arbitrary-value class — `bg-[#3ecf8e]` — is a literal wearing a token's
// syntax. The palette pattern above cannot see it, because it matches Tailwind
// *names*, and this form skips the name entirely. Two shipped for months on
// that technicality: Supabase's green on a checkbox in ScanAccountsModal and
// Cloudflare's orange on a button in the canvas drawer.
const ARBITRARY_PREFIX =
  "(?:text|bg|border|ring|from|to|via|fill|stroke|decoration|outline|divide|placeholder|shadow)";
const ARBITRARY_HEX = `${ARBITRARY_PREFIX}-\\[#[0-9a-fA-F]{3,8}`;

// The other half of the same hole. eslint reads className strings, so an
// inline `style={{ color: "#ef4444" }}` was invisible to every rule here —
// which is exactly where the ones that survived were hiding.
const STYLE_PROP =
  "^(?:color|background|backgroundColor|borderColor|borderTopColor|borderRightColor|borderBottomColor|borderLeftColor|fill|stroke|outlineColor|caretColor|textDecorationColor|columnRuleColor)$";
const CSS_LITERAL = "^(?:#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\()";

const PALETTE_MSG =
  "Use the state tones (text-ok / text-warn / text-crit) or a token. Raw Tailwind palette colours are not part of the console design system.";
const WHITE_MSG =
  "text-white is a literal, not a token — it does not flip with the theme. Use text-foreground / muted-foreground / dim, or bg-secondary.";
const ARBITRARY_MSG =
  "An arbitrary hex class is a literal, not a token — it does not flip with the theme, and a provider's brand colour is a category, which takes no hue. Use a token.";
const STYLE_MSG =
  "A literal colour in an inline style does not flip with the theme, and no lint rule here can see the class you would have written instead. Use var(--token).";

/** One selector pair per pattern: className strings are Literals, and the
 *  conditional `${cond ? "a" : "b"}` forms are TemplateElements. */
const banned = (pattern, message) => [
  { selector: `Literal[value=/\\b${pattern}\\b/]`, message },
  { selector: `TemplateElement[value.raw=/\\b${pattern}\\b/]`, message },
];

/** Same two shapes, without the trailing \b — `bg-[#fff]` ends in `]`, and a
 *  word boundary after a hex digit would not match the closing bracket. */
const bannedOpen = (pattern, message) => [
  { selector: `Literal[value=/\\b${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/\\b${pattern}/]`, message },
];

const PALETTE_RULES = banned(`${PALETTE_PREFIX}-${PALETTE}`, PALETTE_MSG);
const WHITE_RULES = banned(`${WHITE_PREFIX}-white`, WHITE_MSG);
const ARBITRARY_RULES = bannedOpen(ARBITRARY_HEX, ARBITRARY_MSG);

/**
 * A CSS colour property assigned a literal, in an object literal.
 *
 * Keyed on the property name rather than on the enclosing `style={{…}}`,
 * because the same object is just as wrong when it is hoisted to a const and
 * spread in later — which is how `fallbackStyle` in the canvas route held its
 * hex. The theme-swatch previews in settings/appearance are untouched: their
 * keys are `bg`/`panel`/`ink`, not CSS property names, and a swatch showing
 * what a theme looks like has to be a literal.
 */
const STYLE_RULES = [
  {
    selector: `Property[key.name=/${STYLE_PROP}/] > Literal[value=/${CSS_LITERAL}/]`,
    message: STYLE_MSG,
  },
  {
    selector: `Property[key.value=/${STYLE_PROP}/] > Literal[value=/${CSS_LITERAL}/]`,
    message: STYLE_MSG,
  },
  {
    selector: `Property[key.name=/${STYLE_PROP}/] > TemplateLiteral > TemplateElement[value.raw=/${CSS_LITERAL}/]`,
    message: STYLE_MSG,
  },
];

// The landing and blog are a separate design system that does not flip themes,
// so white is a literal there on purpose. They still get the
// palette rule — they have never used it.
const MARKETING = ["src/components/marketing/**", "src/routes/index.tsx"];

// Inside the product mockups the colours are a drawing, not chrome — frame
// fills, skeleton bars, node bodies. The marketing design system already
// grants raw alphas in here; an arbitrary hex is the same latitude by another
// spelling.
const MARKETING_MOCK = ["src/components/marketing/mock/**"];

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
      "no-restricted-syntax": [
        "error",
        ...PALETTE_RULES,
        ...WHITE_RULES,
        ...ARBITRARY_RULES,
        ...STYLE_RULES,
      ],
    },
  },
  {
    // These pages are single-theme, so a literal cannot break a flip here —
    // but it is still a colour outside the token table, and both new rules
    // came back clean across the whole surface, so they cost nothing to keep.
    // `-white` is the one that stays off: DESIGN.md is explicit that these
    // pages do not flip, so white is a literal here on purpose.
    files: MARKETING,
    ignores: MARKETING_MOCK,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...PALETTE_RULES,
        ...ARBITRARY_RULES,
        ...STYLE_RULES,
      ],
    },
  },
  {
    // Separate block rather than a wider `ignores`, so the mockups keep the
    // palette rule. They have never used a Tailwind palette name and there is
    // no reason for them to start.
    files: MARKETING_MOCK,
    rules: { "no-restricted-syntax": ["error", ...PALETTE_RULES] },
  },
  eslintPluginPrettier,
);
