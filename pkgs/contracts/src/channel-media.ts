export interface ChannelMedia {
  id: string
  kind: 'image' | 'audio' | 'video' | 'file'
  name: string
  mimeType: string
  data: Uint8Array
}

export interface SendControl {
  beforePart?(): void | Promise<void>
  received?(messageIds: string[], sentAt: number): void | Promise<void>
}

/** A local veto before the next transport call. No unknown external send is implied. */
export class SendBlocked extends Error {
  constructor(cause: unknown) {
    super('交付在下一段发送前停止', { cause })
  }
}

export class PartialDelivery extends Error {
  constructor(
    readonly messageIds: string[],
    readonly sentAt: number,
    cause: unknown
  ) {
    super('消息已部分发送，后续回执无法确认', { cause })
  }
}

export function mediaKind(mimeType: string): ChannelMedia['kind'] {
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) {
    return 'image'
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }
  if (mimeType.startsWith('video/')) {
    return 'video'
  }
  return 'file'
}
