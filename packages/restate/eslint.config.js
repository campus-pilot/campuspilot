import node from '@campuspilot/config/eslint/node';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...node,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];
