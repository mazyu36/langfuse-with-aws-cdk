/* eslint-disable */
const pluginJs = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

module.exports = [
  { files: ["**/*.ts"] },
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      ...prettier.rules,
    },
  },
  {
    ignores: ["**/*.d.ts"],
  },
];
