// Getting a photo ready to send.
//
// Photos are re-encoded (longest side up to 2560px) rather than sent as-is. That keeps
// them light, turns iPhone HEIC into something every browser can show, and drops
// embedded metadata such as the GPS location. GIFs go untouched so they keep moving.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_SIDE = 2560

export interface PreparedImage {
  blob: Blob
  ext: string
  width: number
  height: number
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('Only photos and GIFs can be sent here.')
  }

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    throw new Error('This browser can’t open that photo’s format. Try sending it as a JPEG or PNG.')
  }
  const { width, height } = bitmap

  if (file.type === 'image/gif') {
    bitmap.close()
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('That GIF is over 10 MB. Try a smaller one.')
    return { blob: file, ext: 'gif', width, height }
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  let blob = await toBlob(canvas, 'image/webp', 0.9)
  let ext = 'webp'
  // Browsers that can't encode WebP hand back a PNG instead; use JPEG, on white for transparency.
  if (!blob || blob.type !== 'image/webp') {
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    blob = await toBlob(canvas, 'image/jpeg', 0.9)
    ext = 'jpg'
  }
  if (!blob) throw new Error('Could not prepare that photo. Try a different one.')
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is still over 10 MB after shrinking it.')
  return { blob, ext, width: w, height: h }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}
