import { request } from '../api'
import {
  ProviderEditorSnapshotSchema,
  RemoteModelsSchema,
  ModelProbeResultSchema,
  type ProviderDraft,
  type ProviderEditorSnapshot
} from '@pi-im-bot/providers/editor-contracts'
import type { ProviderGroup, CandidateRef } from '@pi-im-bot/providers/schema'

function json(method: string, body: object, signal?: AbortSignal): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }
}

export function loadProviders() {
  return request('/api/providers/config', ProviderEditorSnapshotSchema)
}

export function saveProvider(snapshot: ProviderEditorSnapshot, provider: ProviderDraft, previousId?: string) {
  let path = '/api/providers'
  let method = 'POST'
  if (previousId) {
    path += `/${encodeURIComponent(previousId)}`
    method = 'PUT'
  }
  return request(path, ProviderEditorSnapshotSchema, json(method, { revision: snapshot.revision, provider }))
}

export function deleteProvider(snapshot: ProviderEditorSnapshot, id: string) {
  return request(
    `/api/providers/${encodeURIComponent(id)}`,
    ProviderEditorSnapshotSchema,
    json('DELETE', { revision: snapshot.revision })
  )
}

export function fetchModels(
  snapshot: ProviderEditorSnapshot,
  provider: ProviderDraft,
  providerId?: string,
  signal?: AbortSignal
) {
  return request(
    '/api/providers/models/list',
    RemoteModelsSchema,
    json('POST', { revision: snapshot.revision, provider, providerId }, signal)
  )
}

export function testModel(
  snapshot: ProviderEditorSnapshot,
  provider: ProviderDraft,
  modelId: string,
  providerId?: string,
  signal?: AbortSignal
) {
  return request(
    '/api/providers/models/test',
    ModelProbeResultSchema,
    json('POST', { revision: snapshot.revision, provider, providerId, modelId }, signal)
  )
}

export function saveGroup(snapshot: ProviderEditorSnapshot, group: ProviderGroup, previousId?: string) {
  let path = '/api/provider-groups'
  let method = 'POST'
  if (previousId) {
    path += `/${encodeURIComponent(previousId)}`
    method = 'PUT'
  }
  return request(path, ProviderEditorSnapshotSchema, json(method, { revision: snapshot.revision, group }))
}

export function deleteGroup(snapshot: ProviderEditorSnapshot, id: string) {
  return request(
    `/api/provider-groups/${encodeURIComponent(id)}`,
    ProviderEditorSnapshotSchema,
    json('DELETE', { revision: snapshot.revision })
  )
}

export function defaultGroup(snapshot: ProviderEditorSnapshot, id: string) {
  return request(
    `/api/provider-groups/${encodeURIComponent(id)}/default`,
    ProviderEditorSnapshotSchema,
    json('POST', { revision: snapshot.revision })
  )
}

export function defaultCandidate(snapshot: ProviderEditorSnapshot, candidate: CandidateRef) {
  return request(
    '/api/provider-groups/default-candidate',
    ProviderEditorSnapshotSchema,
    json('POST', { revision: snapshot.revision, candidate })
  )
}
