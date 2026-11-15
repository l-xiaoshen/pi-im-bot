import data from './data.json'
function mapped(code: number, ranges: number[][]) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const middle = Math.floor((lo + hi) / 2)
    const [start, end, value] = ranges[middle]
    if (code < start) {
      hi = middle - 1
    } else if (code > end) {
      lo = middle + 1
    } else {
      return value + code - start
    }
  }
  return undefined
}
const special = new Map(Object.entries(data.special).map(([key, value]) => [Number(key), value]))
export function pythonCasefold(value: string) {
  let result = ''
  for (const char of value) {
    const code = char.codePointAt(0)!
    const sequence = special.get(code)
    if (sequence !== undefined) {
      result += sequence
      continue
    }
    const lower = mapped(code, data.fold)
    if (lower !== undefined) {
      result += String.fromCodePoint(lower)
    } else {
      result += char
    }
  }
  return result
}
export function pythonCompare(left: string, right: string) {
  const a = Array.from(pythonCasefold(left), (char) => char.codePointAt(0)!)
  const b = Array.from(pythonCasefold(right), (char) => char.codePointAt(0)!)
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return a.length - b.length
}
export function pythonStrip(value: string) {
  return value.replace(
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,
    ''
  )
}
export function pythonDecimal(value: string) {
  const text = value.replace(
    /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,
    ''
  )
  let digits = ''
  let previousDigit = false
  for (const char of text) {
    if (!digits && (char === '+' || char === '-')) {
      digits = char
      continue
    }
    if (char === '_') {
      if (!previousDigit) {
        throw new Error('Invalid integer')
      }
      previousDigit = false
      continue
    }
    const digit = mapped(char.codePointAt(0)!, data.decimal)
    if (digit === undefined || digit < 0 || digit > 9) {
      throw new Error('Invalid integer')
    }
    digits += String(digit)
    previousDigit = true
  }
  if (!previousDigit) {
    throw new Error('Invalid integer')
  }
  const number = Number(digits)
  if (number === 0) {
    return 0
  }
  return number
}
