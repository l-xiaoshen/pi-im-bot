import type { GsviService } from './schema'
import { revision } from '@pi-im-bot/settings/resolve'

/** Display labels are not execution policy. All transport, credential and budget fields remain pinned. */
export function gsviExecutionRevision(service: GsviService) {
  const { name: _name, ...execution } = service
  return revision(execution)
}
