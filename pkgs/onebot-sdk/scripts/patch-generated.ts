import { readFile, writeFile } from "node:fs/promises"

const path = new URL("../src/generated/types.gen.ts", import.meta.url)
const source = await readFile(path, "utf8")
const from = "export type ActionName = typeof ActionName[keyof typeof ActionName];"
const to = "export type ActionName = typeof ActionName[keyof typeof ActionName] | (string & {});"

if (!source.includes(from)) {
  throw new Error("ActionName type not found in generated types")
}

await writeFile(path, source.replace(from, to))
