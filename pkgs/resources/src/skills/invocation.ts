export function requestedSkill(text: string) {
  return text.trimStart().match(/^\/skill\s+([a-z][a-z0-9_-]*)(?:\s|$)/)?.[1]
}
