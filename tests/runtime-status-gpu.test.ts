import { expect, test } from 'bun:test'
import { GpuStatusSchema } from '@pi-im-bot/runtime/status/schema'
import { parseNvidiaSmiCsv } from '@pi-im-bot/runtime/status/gpu'

test('NVIDIA probe parser normalizes fixed CSV output to bounded GPU and VRAM metrics', () => {
  const value = parseNvidiaSmiCsv(
    '0, NVIDIA GeForce RTX 4080 SUPER, 32760, 6964, 0, 32, 18.14\n' +
      '1, NVIDIA RTX A3000 Laptop GPU, 12288, 125, 0, 42, 11.62\n'
  )
  expect(value).toBeDefined()
  const parsed = GpuStatusSchema.parse(value)
  expect(parsed.provider).toBe('nvidia')
  expect(parsed.devices).toHaveLength(2)
  expect(parsed.devices[0].memoryTotalBytes).toBe(32760 * 1024 * 1024)
  expect(parsed.devices[0].memoryUsedBytes).toBe(6964 * 1024 * 1024)
  expect(parsed.devices[1].temperatureC).toBe(42)
})

test('NVIDIA probe parser rejects unusable rows without exposing raw command output', () => {
  expect(parseNvidiaSmiCsv('N/A, N/A, N/A, N/A, N/A, N/A, N/A\n')).toBeUndefined()
})
