/**
 * Draws simple landscape pictures (sky, sun, hills) as PNG files with no
 * image library, so the seeded posts have real images to show.
 */
import { crc32, deflateSync } from 'node:zlib'

type RGB = [number, number, number]

const PALETTES: { sky: [RGB, RGB]; sun: RGB; hills: RGB[] }[] = [
  { sky: [[255, 183, 130], [255, 236, 210]], sun: [255, 245, 225], hills: [[232, 120, 92], [196, 82, 72], [128, 52, 62]] },
  { sky: [[120, 180, 230], [215, 236, 250]], sun: [255, 250, 220], hills: [[120, 170, 120], [70, 130, 95], [35, 85, 70]] },
  { sky: [[44, 44, 92], [150, 110, 170]], sun: [250, 230, 200], hills: [[90, 70, 130], [60, 46, 100], [30, 24, 60]] },
  { sky: [[250, 210, 120], [255, 244, 200]], sun: [255, 255, 240], hills: [[214, 160, 90], [176, 120, 64], [120, 80, 46]] },
  { sky: [[150, 210, 205], [230, 246, 240]], sun: [255, 255, 245], hills: [[90, 160, 160], [52, 120, 128], [28, 76, 90]] },
  { sky: [[245, 160, 175], [252, 225, 225]], sun: [255, 250, 250], hills: [[200, 110, 140], [150, 72, 110], [90, 40, 75]] },
]

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const cache = new Map<string, Buffer>()

export function landscapePng(seed: number, width = 800, height = 500): Buffer {
  const key = `${seed}:${width}x${height}`
  const hit = cache.get(key)
  if (hit) return hit
  const png = draw(seed, width, height)
  cache.set(key, png)
  return png
}

function draw(seed: number, width: number, height: number): Buffer {
  const p = PALETTES[seed % PALETTES.length]!
  const sunX = width * (0.25 + ((seed * 37) % 50) / 100)
  const sunY = height * 0.38
  const sunR = height * 0.11
  const phase = seed * 1.7
  const ridge = (layer: number, x: number) =>
    height * (0.52 + layer * 0.13) +
    Math.sin(x / (90 + layer * 40) + phase + layer) * (28 - layer * 6) +
    Math.sin(x / 37 + phase * 2 + layer * 3) * (8 - layer * 2)

  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      let c = mix(p.sky[0], p.sky[1], Math.min(1, y / (height * 0.6)))
      const d = Math.hypot(x - sunX, y - sunY)
      if (d < sunR) c = p.sun
      else if (d < sunR * 1.6) c = mix(p.sun, c, (d - sunR) / (sunR * 0.6))
      for (let layer = 0; layer < p.hills.length; layer++) {
        if (y > ridge(layer, x)) c = p.hills[layer]!
      }
      const i = row + 1 + x * 3
      raw[i] = Math.round(c[0])
      raw[i + 1] = Math.round(c[1])
      raw[i + 2] = Math.round(c[2])
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
