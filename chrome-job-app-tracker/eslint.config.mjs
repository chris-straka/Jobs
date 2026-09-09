import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/server/src/**/*.ts", "packages/shared/src/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["packages/extension/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
);
