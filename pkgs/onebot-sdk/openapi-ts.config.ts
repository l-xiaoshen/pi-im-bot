import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  input: "../onebot-spec/tsp-output/schema/openapi.yaml",
  output: {
    path: "src/generated",
    entryFile: false
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      enums: "javascript"
    },
    "@hey-api/transformers",
    {
      name: "@hey-api/sdk",
      transformer: true
    },
    "@hey-api/client-fetch"
  ]
})
