import type { PluginContext } from './index'
import { GsviInputSchema, GsviResultSchema, type GsviInput } from '@pi-im-bot/integrations/gsvi/schema'
import { MediaChunkSchema, MediaReadSchema } from '@pi-im-bot/plugins/media-rpc'
import type { z } from 'zod'
import {
  GsviCatalogueSchema,
  GsviCatalogueReadSchema,
  GsviCataloguePageSchema,
  GsviCatalogueMatchSchema
} from '@pi-im-bot/integrations/gsvi/catalogue-contract'

export async function gsvi(context: PluginContext, alias: string, input: GsviInput) {
  context.signal.throwIfAborted()
  return GsviResultSchema.parse(await context.host('service:' + alias, GsviInputSchema.parse(input)))
}

export async function readMedia(context: PluginContext, input: z.input<typeof MediaReadSchema>) {
  context.signal.throwIfAborted()
  return MediaChunkSchema.parse(await context.host('media.read', MediaReadSchema.parse(input)))
}

export async function gsviCatalogue(context: PluginContext, alias: string, version: 'v1' | 'v2' | 'v4') {
  return GsviCatalogueSchema.parse(await gsvi(context, alias, { action: 'voices', version }))
}
export async function gsviCataloguePage(
  context: PluginContext,
  alias: string,
  reference: string,
  offset = 0
) {
  context.signal.throwIfAborted()
  const input = GsviCatalogueReadSchema.parse({ action: 'page', reference, offset })
  return GsviCataloguePageSchema.parse(await context.host('service:' + alias + '/catalogue', input))
}
export async function gsviCatalogueMatch(
  context: PluginContext,
  alias: string,
  reference: string,
  voice: string,
  emotion: string
) {
  context.signal.throwIfAborted()
  const input = GsviCatalogueReadSchema.parse({ action: 'match', reference, voice, emotion })
  return GsviCatalogueMatchSchema.parse(await context.host('service:' + alias + '/catalogue', input))
}
