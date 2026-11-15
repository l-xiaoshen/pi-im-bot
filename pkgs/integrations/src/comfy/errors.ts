export class ComfyTransportError extends Error {
  constructor(readonly outcome: 'rejected' | 'unknown' | 'read' | 'refused') {
    super('Comfy服务请求未完成')
  }
}
export class ComfyOutputRefused extends Error {}
