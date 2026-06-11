const js = require("@eslint/js");
const prettier = require("eslint-config-prettier/flat");
const globals = require("globals");
const typescript = require("typescript-eslint");

module.exports = [
  js.configs.recommended,
  ...typescript.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  prettier,
];
