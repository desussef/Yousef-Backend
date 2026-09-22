import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const extensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
}

function publicUrl(baseUrl, key) {
  return `${baseUrl.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function s3Configuration() {
  const { S3_BUCKET: bucket, S3_REGION: region, S3_ENDPOINT: endpoint, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey, S3_PUBLIC_BASE_URL: publicBaseUrl } = process.env
  if (!bucket) return null
  if (!region || !publicBaseUrl || !accessKeyId || !secretAccessKey) throw new Error('S3 media storage is not fully configured.')
  return { bucket, publicBaseUrl, client: new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId, secretAccessKey } }) }
}

export async function storeMedia(file) {
  const extension = extensions[file.mimetype]
  if (!extension) throw new Error('Unsupported file type.')
  const key = `portfolio/uploads/${new Date().getUTCFullYear()}/${crypto.randomUUID()}${extension}`
  const s3 = s3Configuration()
  if (s3) {
    await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype, CacheControl: 'public, max-age=31536000, immutable' }))
    return { objectKey: key, publicUrl: publicUrl(s3.publicBaseUrl, key), provider: 's3' }
  }
  if (process.env.APP_ENV === 'production') throw new Error('S3 media storage is not configured.')
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads')
  const filename = path.basename(key)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), file.buffer, { flag: 'wx' })
  return { objectKey: filename, publicUrl: `${process.env.BACKEND_URL || 'http://localhost:3001'}/uploads/${filename}`, provider: 'local' }
}
