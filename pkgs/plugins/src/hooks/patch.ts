import { z } from "zod"
import { revision } from "@pi-im-bot/settings/resolve"
import { TransformPatchSchema } from "./points"
import { patchPathSegments, writablePath } from "./path"

function update(
  input: unknown,
  path: string[],
  change: z.infer<typeof TransformPatchSchema>["patch"][number],
  writable: readonly string[][],
  parent: readonly string[] = []
): unknown {
  const [key, ...rest] = path
  const array = z.array(z.json()).safeParse(input)
  if (array.success) {
    if (!/^(?:0|[1-9]\d*)$/u.test(key)) {
      throw new Error("数组 patch 索引无效")
    }
    const index = Number(key)
    if (index >= array.data.length) {
      throw new Error("数组 patch 越界")
    }
    if (rest.length > 0) {
      array.data[index] = z.json().parse(update(array.data[index], rest, change, writable, [...parent, key]))
    } else if (change.op === "remove") {
      if (!writablePath(parent, writable)) {
        throw new Error("删除数组元素需要整个数组的可写权限")
      }
      array.data.splice(index, 1)
    } else {
      array.data[index] = change.value
    }
    return array.data
  }
  const object = z.record(z.string(), z.json()).parse(input)
  const fields = new Map(Object.entries(object))
  if (rest.length > 0) {
    if (!fields.has(key)) {
      throw new Error("patch 的父路径不存在")
    }
    fields.set(key, z.json().parse(update(fields.get(key), rest, change, writable, [...parent, key])))
  } else if (change.op === "remove") {
    fields.delete(key)
  } else {
    fields.set(key, change.value)
  }
  return Object.fromEntries(fields)
}

export function applyHookPatch(input: unknown, raw: unknown, writable: readonly string[]) {
  const patch = TransformPatchSchema.parse(raw)
  if (patch.baseRevision !== revision(input)) {
    throw new Error("插件 patch 基于过期输入，未应用")
  }
  let output = structuredClone(input)
  const allowed = writable.map(patchPathSegments)
  for (const change of patch.patch) {
    const path = patchPathSegments(change.path)
    if (!writablePath(path, allowed)) {
      throw new Error("插件越过可写字段：" + change.path)
    }
    output = update(output, path, change, allowed)
  }
  return output
}
