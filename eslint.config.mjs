import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    files: ["lib/todos.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["node:*", "pg", "pg/**", "next", "next/**", "react", "react/**", "react-dom", "react-dom/**", "**/db", "**/db.*", "**/app/**"],
          message: "Todo rules and types must stay independent of database, IO, and delivery adapters.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", "build/**", "coverage/**", "node_modules/**", "tmp/**"]),
]);
