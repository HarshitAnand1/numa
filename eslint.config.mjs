import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "packages/contracts/**", ".agents/**", ".claude/**", "**/*.json"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore-prefixed names are intentionally unused (e.g. destructuring to drop a field).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      // Chain/RPC boundaries use a few deliberate casts; keep `any` out of everything else.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Figma-derived SPA keeps not-yet-routed screens (e.g. CampaignDetail); don't fail CI on those until wired.
    files: ["apps/web/src/**"],
    rules: { "@typescript-eslint/no-unused-vars": "warn" },
  },
);
