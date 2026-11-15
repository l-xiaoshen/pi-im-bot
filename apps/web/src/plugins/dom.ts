export { element as node, button } from '../dom'
import { element } from '../dom'

export function pill(label: string, tone = '') {
  return element('span', 'pill ' + tone, label)
}
export function pluginIcon(name: string) {
  return element('div', 'plugin-icon mint', name.slice(0, 1))
}
