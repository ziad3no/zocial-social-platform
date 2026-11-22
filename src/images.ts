import { IMAGE_MAX_BYTES } from '../shared/schemas'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const ACCEPT_ATTR = ACCEPTED.join(',')

/**
 * Shrinks a photo in the browser before upload: at most `maxSide` pixels on
 * the longest side, re-encoded as WebP. That keeps uploads small and drops
 * metadata such as the GPS location phones add to photos. GIFs are sent
 * unchanged so animations keep working.
 */
export async function prepareImage(file: File, maxSide = 1600): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a JPG, PNG, WebP or GIF image.')
  if (file.type === 'image/gif') {
    if (file.size > IMAGE_MAX_BYTES) throw new Error('GIFs can be up to 3 MB.')
    return file
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('That photo is over 20 MB. Choose a smaller one.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. It may be damaged.')
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  if (!blob) throw new Error('That image could not be processed.')
  if (blob.size > IMAGE_MAX_BYTES) throw new Error('That image is still over 3 MB after resizing.')
  return blob
}
