/**
 * @file TrayIconRenderer.ts
 * @description Renders ordered tray-icon bars into a 32x32 RGBA PNG buffer for Electron nativeImage system tray icons.
 */

import { deflateSync } from 'node:zlib'
import type { IconBar } from './IconLayout'

/** Pixel size of the square system tray icon. */
export const TRAY_ICON_SIZE = 32

const PlateInset = 2
const BarLeft = 4
const BarRight = TRAY_ICON_SIZE - 4
const BarWidth = BarRight - BarLeft
const ContentTop = 6
const ContentBottom = TRAY_ICON_SIZE - 6
const ContentHeight = ContentBottom - ContentTop
const SepSameProvider = 1
const SepCrossProvider = 2

const Plate: readonly [number, number, number] = [60, 60, 70]
const Track: readonly [number, number, number] = [80, 80, 90]

/** Usage severity thresholds for bar color mapping. */
enum UsageLevel {
  Low,
  Medium,
  High,
  Critical,
}

/** Render specification for a single bar's Y position, height, and usage percentage. */
interface BarSpec {
  y: number
  height: number
  usedPercent: number | null
}

/**
 * Determines the UsageLevel enum value based on usage percentage.
 *
 * @param percent - Usage percentage (0-100)
 * @returns UsageLevel enum value
 */
const levelFromPercent = (percent: number): UsageLevel => {
  if (percent < 50) return UsageLevel.Low
  if (percent < 80) return UsageLevel.Medium
  if (percent < 95) return UsageLevel.High
  return UsageLevel.Critical
}

/**
 * Returns the RGB color tuple for a given UsageLevel.
 *
 * @param level - Usage severity level
 * @returns Readonly RGB tuple [r, g, b]
 */
const levelColor = (level: UsageLevel): readonly [number, number, number] => {
  switch (level) {
    case UsageLevel.Low:
      return [76, 175, 80]
    case UsageLevel.Medium:
      return [255, 193, 7]
    case UsageLevel.High:
      return [255, 152, 0]
    case UsageLevel.Critical:
      return [244, 67, 54]
    default:
      return [76, 175, 80]
  }
}

/**
 * Assigns pixel Y positions and heights to each bar spec within the content bounds.
 *
 * @param input - Array of IconBar items
 * @returns Array of calculated BarSpec layout objects
 */
const assignBarPositions = (input: IconBar[]): BarSpec[] => {
  let ordered = input
  if (ordered.length === 0) {
    ordered = [{ usedPercent: null, weight: 1, provider: 'None' }]
  }

  const count = ordered.length
  const bars: BarSpec[] = []

  let totalSeparator = 0
  for (let i = 0; i < count - 1; i++) {
    const current = ordered[i]
    const next = ordered[i + 1]
    if (!current || !next) break
    totalSeparator += current.provider !== next.provider ? SepCrossProvider : SepSameProvider
  }

  const available = Math.max(1, ContentHeight - totalSeparator)
  let totalWeight = 0
  for (let i = 0; i < count; i++) {
    const bar = ordered[i]
    if (bar) totalWeight += bar.weight
  }
  if (totalWeight <= 0) totalWeight = count

  let y = ContentTop
  for (let i = 0; i < count; i++) {
    if (y >= ContentBottom) break
    const current = ordered[i]
    if (!current) break
    const isLast = i === count - 1
    const height = isLast
      ? Math.max(1, ContentBottom - y)
      : Math.max(1, Math.round((available * current.weight) / totalWeight))

    bars.push({
      y,
      height: Math.min(height, Math.max(1, ContentBottom - y)),
      usedPercent: current.usedPercent,
    })
    y += height

    const next = ordered[i + 1]
    if (i < count - 1 && next && current.provider !== next.provider) {
      y += SepCrossProvider
    } else if (i < count - 1) {
      y += SepSameProvider
    }
  }

  const last = bars[bars.length - 1]
  if (last) {
    last.height = Math.max(1, ContentBottom - last.y)
  }

  return bars
}

/**
 * Renders bar specifications into a 32x32 RGBA pixel buffer (row-major, top to bottom).
 *
 * @param bars - Array of IconBar items to render
 * @returns Raw RGBA Uint8Array buffer
 */
export const renderTrayPixels = (bars: IconBar[]): Uint8Array => {
  const pixels = new Uint8Array(TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4)
  const put = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (x < 0 || x >= TRAY_ICON_SIZE || y < 0 || y >= TRAY_ICON_SIZE) return
    const index = (y * TRAY_ICON_SIZE + x) * 4
    pixels[index] = r
    pixels[index + 1] = g
    pixels[index + 2] = b
    pixels[index + 3] = a
  }

  for (let y = PlateInset; y < TRAY_ICON_SIZE - PlateInset; y++) {
    for (let x = PlateInset; x < TRAY_ICON_SIZE - PlateInset; x++) {
      put(x, y, Plate[0], Plate[1], Plate[2], 255)
    }
  }

  for (const spec of assignBarPositions(bars)) {
    for (let y = spec.y; y < spec.y + spec.height; y++) {
      for (let x = BarLeft; x < BarRight; x++) {
        put(x, y, Track[0], Track[1], Track[2], 255)
      }
    }

    if (spec.usedPercent === null) continue

    const color = levelColor(levelFromPercent(spec.usedPercent))
    const clamped = Math.min(100, Math.max(0, spec.usedPercent))
    const fillEnd = Math.min(BarRight, BarLeft + Math.round((BarWidth * clamped) / 100))
    for (let y = spec.y; y < spec.y + spec.height; y++) {
      for (let x = BarLeft; x < fillEnd; x++) {
        put(x, y, color[0], color[1], color[2], 255)
      }
    }
  }

  return pixels
}

/** Precomputed CRC32 table for PNG chunk encoding. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Computes CRC32 checksum for PNG chunk data.
 *
 * @param data - Input byte buffer
 * @returns 32-bit unsigned CRC integer
 */
const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Creates a PNG chunk buffer (length, type, data, crc).
 *
 * @param type - 4-character ASCII chunk type name
 * @param data - Chunk payload buffer
 * @returns Formatted PNG chunk Buffer
 */
const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, Buffer.from(data)])))
  return Buffer.concat([length, typeBuffer, Buffer.from(data), crc])
}

/**
 * Encodes a square RGBA pixel buffer (row-major, top to bottom) into a valid PNG Buffer.
 *
 * @param size - Image dimension in pixels (e.g. 32)
 * @param pixels - Raw RGBA byte array
 * @returns PNG encoded Buffer
 */
export const encodeRgbaPng = (size: number, pixels: Uint8Array): Buffer => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(pixels).copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Encodes rendered bars into a PNG buffer suitable for Electron's nativeImage.createFromBuffer.
 *
 * @param bars - Array of IconBar items
 * @returns PNG Buffer ready for nativeImage
 */
export const renderTrayIconPng = (bars: IconBar[]): Buffer =>
  encodeRgbaPng(TRAY_ICON_SIZE, renderTrayPixels(bars))
