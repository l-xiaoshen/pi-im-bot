import type { JobRevision } from '../schema'
import type { ExternalOutcome } from './state'
type JobResult = NonNullable<JobRevision['result']>
type ResultItem = NonNullable<JobResult['items']>[number]
function confirmed(item: ResultItem) {
  return ['succeeded', 'failed', 'cancelled'].includes(item.status)
}

/** A query may add facts; a missing result or unresolved item cannot retract confirmed evidence. */
export function mergeJobResult(previous: JobResult | undefined, incoming: JobResult | undefined) {
  if (!previous) {
    return incoming
  }
  if (!incoming) {
    return previous
  }
  const result: JobResult = {
    ...previous,
    ...incoming,
    artifactIds: [...new Set([...previous.artifactIds, ...incoming.artifactIds])]
  }
  if (previous.items || incoming.items) {
    const items = new Map<number, ResultItem>()
    for (const item of previous.items ?? []) {
      items.set(item.item, item)
    }
    for (const item of incoming.items ?? []) {
      const saved = items.get(item.item)
      if (!saved) {
        items.set(item.item, item)
        continue
      }
      let merged = { ...saved, ...item }
      if (confirmed(saved)) {
        merged = { ...item, ...saved }
      }
      merged.artifactIds = [...new Set([...saved.artifactIds, ...item.artifactIds])]
      items.set(item.item, merged)
    }
    result.items = [...items.values()].sort((left, right) => {
      return left.item - right.item
    })
    const unresolved = result.items.some((item) => {
      return !confirmed(item)
    })
    if (unresolved) {
      result.factsComplete = false
    }
    const successes = result.items.filter((item) => {
      return item.status === 'succeeded'
    }).length
    if (successes) {
      result.businessStatus = 'partial'
      if (successes === result.items.length && result.factsComplete !== false) {
        result.businessStatus = 'succeeded'
      }
    }
  }
  const retainsArtifacts = previous.artifactIds.every((id) => {
    return incoming.artifactIds.includes(id)
  })
  const retainsItems = (previous.items ?? []).filter(confirmed).every((saved) => {
    return incoming.items?.some((item) => {
      return item.item === saved.item && item.status === saved.status
    })
  })
  if (!retainsArtifacts || !retainsItems) {
    result.summary = previous.summary
  }
  return result
}

export function mergeExternalOutcome(
  previous: JobResult | undefined,
  incoming: ExternalOutcome
): ExternalOutcome {
  const result = mergeJobResult(previous, incoming.result)
  const outcome = { ...incoming, result }
  if (result?.factsComplete === false) {
    outcome.state = 'outcome_unknown'
  }
  return outcome
}
