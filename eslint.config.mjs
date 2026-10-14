// AgentRiskLayer ESLint regression baseline for the 56 reported candidates.
// Only Node.js runtime globals used by these server-side sources are declared.
export default [
  {
    files: ['src/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'error',
      'no-undef': 'error',
      'no-useless-escape': 'error',
      'no-useless-assignment': 'error',
      'no-control-regex': 'error',
      'no-empty': 'error',
      'preserve-caught-error': 'error',
      'no-extra-boolean-cast': 'error'
    }
  }
];
