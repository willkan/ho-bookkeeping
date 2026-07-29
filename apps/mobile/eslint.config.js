const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'coverage/**'],
  },
  {
    rules: {
      'import/no-unresolved': 'off',
      // Form hydration from SQLite facts on navigation is intentional.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
