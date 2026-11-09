import sharp from 'sharp'
import jsQRModule from 'jsqr'
const jsQR = ((jsQRModule as any).default ?? jsQRModule) as typeof import('jsqr').default
import { parseCode } from './codes.js'
import type { PageRef } from '../shared/types.js'

export interface DecodeResult {
  text: string | null
  ref: PageRef | null
  width: number
  height: number
  strategy: string | null
}

interface Raw {
  data: Uint8ClampedArray
  width: number
  height: number
}

async function toRaw(img: sharp.Sharp): Promise<Raw> {
  // jsQR wants RGBA. sharp hands back 1 channel for greyscale or thresholded
  // images, 3 for colour, so expand whatever arrives to 4 channels here.
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const ch = info.channels
  if (ch === 4) return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const s = i * ch
    const d = i * 4
    if (ch === 1 || ch === 2) {
      out[d] = out[d + 1] = out[d + 2] = data[s]
    } else {
      out[d] = data[s]
      out[d + 1] = data[s + 1]
      out[d + 2] = data[s + 2]
    }
    out[d + 3] = 255
  }
  return { data: out, width: info.width, height: info.height }
}

function tryDecode(raw: Raw): string | null {
  const r = jsQR(raw.data, raw.width, raw.height, { inversionAttempts: 'attemptBoth' })
  return r?.data ?? null
}

// Reads the QR code off a scanned page. Tries the whole page at a modest size
// first (fast), then each corner at full resolution (the code is small), then
// a sharpened, thresholded pass for faint or skewed scans.
export async function decodePage(file: string): Promise<DecodeResult> {
  const base = sharp(file, { failOn: 'none' }).rotate() // honour EXIF orientation
  const meta = await base.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const result = (text: string | null, strategy: string | null): DecodeResult => ({ text, ref: parseCode(text), width, height, strategy })

  // 1. whole page, downscaled
  for (const w of [1000, 1600]) {
    if (width && w > width) continue
    const text = tryDecode(await toRaw(base.clone().resize({ width: w }).grayscale()))
    if (text) return result(text, `whole@${w}`)
  }

  // 2. corners at full resolution
  if (width && height) {
    const cw = Math.round(width * 0.3)
    const ch = Math.round(height * 0.3)
    const corners: Array<[string, number, number]> = [
      ['tr', width - cw, 0],
      ['tl', 0, 0],
      ['br', width - cw, height - ch],
      ['bl', 0, height - ch],
    ]
    for (const [name, left, top] of corners) {
      const crop = base.clone().extract({ left, top, width: cw, height: ch }).grayscale()
      let text = tryDecode(await toRaw(crop.clone()))
      if (text) return result(text, `corner-${name}`)
      text = tryDecode(await toRaw(crop.clone().normalise().sharpen().threshold(140)))
      if (text) return result(text, `corner-${name}-threshold`)
    }
  }

  // 3. whole page at full resolution, thresholded
  if (width && width <= 3000) {
    const text = tryDecode(await toRaw(base.clone().grayscale().normalise().threshold(140)))
    if (text) return result(text, 'whole-threshold')
  }

  return result(null, null)
}

export async function makeThumb(file: string, out: string, width = 360) {
  await sharp(file, { failOn: 'none' }).rotate().resize({ width }).jpeg({ quality: 78 }).toFile(out)
}
