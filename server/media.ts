import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { IMAGE_MAX_BYTES } from '../shared/schemas'
import { nowIso, type DB } from './db'
import { badRequest, HttpError, notFound } from './http'

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

/**
 * Work out the real type from the file's first bytes. The browser's
 * Content-Type and the file name are ignored, because both can lie.
 * SVG is not accepted: it can contain scripts.
 */
export function sniffImage(buf: Uint8Array): ImageMime | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => buf[i + j] === b)
  if (buf.length < 12) return null
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 5 },
})

/** Accept one optional image field. Turns multer errors into friendly 400s. */
export function singleImage(field: string): RequestHandler {
  const handler = upload.single(field)
  return (req, res, next) => {
    handler(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(badRequest('That image is too large.', { image: `Images can be up to ${IMAGE_MAX_BYTES / 1024 / 1024} MB.` }))
        }
        return next(badRequest('The upload could not be read.', { image: 'Attach one image file.' }))
      }
      next(err)
    })
  }
}

export function storeImage(db: DB, ownerId: number, file: Express.Multer.File): number {
  const mime = sniffImage(file.buffer)
  if (!mime) throw badRequest('That file is not a supported image.', { image: 'Use a JPG, PNG, WebP or GIF image.' })
  const { lastInsertRowid } = db
    .prepare('INSERT INTO media (owner_id, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, mime, file.buffer, file.size, nowIso())
  return Number(lastInsertRowid)
}

export function deleteMedia(db: DB, id: number | null) {
  if (id) db.prepare('DELETE FROM media WHERE id = ?').run(id)
}

export function mediaRoutes(db: DB) {
  const router = Router()
  const find = db.prepare('SELECT mime, bytes FROM media WHERE id = ?')
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw notFound('That image')
    const row = find.get(id) as { mime: string; bytes: Uint8Array } | undefined
    if (!row) throw new HttpError(404, 'That image was not found.')
    res.set({
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': 'inline',
    })
    res.send(Buffer.from(row.bytes))
  })
  return router
}
