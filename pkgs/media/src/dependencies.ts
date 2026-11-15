/** Failed/cancelled reads retain their slot until the invocation ends. No churn or concurrent overbooking. */
export function reserveMediaSources(sources: Set<string>, ids: readonly string[]) {
  const additions = [...new Set(ids)].filter((id) => {
    return !sources.has(id)
  })
  if (sources.size + additions.length > 16) {
    throw new Error('本次媒体来源数量超过 16 项上限')
  }
  for (const id of additions) {
    sources.add(id)
  }
}
