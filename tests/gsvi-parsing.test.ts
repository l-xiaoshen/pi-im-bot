import { test, expect } from 'bun:test'
import {
  pythonDecimal,
  pythonCasefold,
  pythonCompare,
  pythonStrip
} from '@pi-im-bot/integrations/gsvi/unicode'
test('source int accepts Unicode decimal, mixed scripts and interior underscores, rejects prefixes and malformed separators', () => {
  for (const [input, value] of [
    ['１２_٣', 123],
    [' +١_٠ ', 10],
    ['-۰', 0],
    ['𝟙𝟚', 12],
    ['\u00851\u3000', 1]
  ] as const) {
    expect(pythonDecimal(input)).toBe(value)
  }
  for (const value of ['', '+', '1__0', '_10', '10_', '1.0', '0x10', '²', '1 0', '\u001c1', '\ufeff1']) {
    expect(() => pythonDecimal(value)).toThrow()
  }
})
test('full Unicode default casefold and codepoint lexicographic ordering are stable rather than locale dependent', () => {
  expect(pythonCasefold('Straße ẞ Σς İ ﬃ')).toBe('strasse ss σσ i\u0307 ffi')
  expect(pythonCasefold('Ꭰꭰ')).toBe('ᎠᎠ')
  expect(pythonStrip('\ufeffa\ufeff')).toBe('\ufeffa\ufeff')
  expect(['b', 'A', 'a', 'Straße', 'STRASSE', '𐐀', '𐐨'].sort(pythonCompare)).toEqual([
    'A',
    'a',
    'b',
    'Straße',
    'STRASSE',
    '𐐀',
    '𐐨'
  ])
})
