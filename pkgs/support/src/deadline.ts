/** A disposable, parent-cancellable deadline without the host timer's 32-bit ceiling. */
export function deadlineScope(parent: AbortSignal, deadlineAt: number) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  function expire() {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) {
      controller.abort(new Error('执行期限已到'))
      return
    }
    timer = setTimeout(expire, Math.min(remaining, 2147483647))
  }
  function close() {
    clearTimeout(timer)
    parent.removeEventListener('abort', close)
  }
  expire()
  parent.addEventListener('abort', close, { once: true })
  if (parent.aborted) {
    close()
  }
  return { signal: AbortSignal.any([parent, controller.signal]), close }
}
