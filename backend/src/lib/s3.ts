import { S3Client } from "@aws-sdk/client-s3"

function readEnv(...keys: string[]) {
  for (const key of keys) {
    const raw = process.env[key]
    if (!raw) continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const unquoted = trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
    if (unquoted) return unquoted
  }
  return ""
}

const STORAGE_ENDPOINT = readEnv(
  "S3_ENDPOINT",
  "AWS_ENDPOINT_URL_S3",
  "ENDPOINT_URL",
  "RAILWAY_BUCKET_ENDPOINT",
  "BUCKET_ENDPOINT",
  "BUCKET_ENDPOINT_URL"
)
const STORAGE_REGION = readEnv(
  "S3_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "REGION",
  "BUCKET_REGION",
  "RAILWAY_BUCKET_REGION"
) || "auto"
const STORAGE_ACCESS_KEY = readEnv(
  "S3_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
  "AWS_ACCESS_KEY_ID",
  "ACCESS_KEY_ID",
  "BUCKET_ACCESS_KEY",
  "BUCKET_ACCESS_KEY_ID",
  "RAILWAY_BUCKET_ACCESS_KEY",
  "RAILWAY_BUCKET_ACCESS_KEY_ID"
)
const STORAGE_SECRET_KEY = readEnv(
  "S3_SECRET_KEY",
  "S3_SECRET_ACCESS_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "SECRET_ACCESS_KEY",
  "BUCKET_SECRET_KEY",
  "BUCKET_SECRET_ACCESS_KEY",
  "RAILWAY_BUCKET_SECRET_KEY",
  "RAILWAY_BUCKET_SECRET_ACCESS_KEY"
)
const FORCE_PATH_STYLE_ENV = readEnv("S3_FORCE_PATH_STYLE")

export const BUCKET_NAME = readEnv("S3_BUCKET_NAME", "BUCKET_NAME", "AWS_S3_BUCKET", "RAILWAY_BUCKET_NAME") || "uploads"
export const STORAGE_PUBLIC_URL = readEnv("S3_PUBLIC_URL", "S3_PUBLIC_BASE_URL") || "http://localhost:9000"
const FORCE_PATH_STYLE = FORCE_PATH_STYLE_ENV === "true"

export const s3 = new S3Client({
  region: STORAGE_REGION,
  endpoint: STORAGE_ENDPOINT || "http://minio:9000",
  credentials: {
    accessKeyId: STORAGE_ACCESS_KEY || "admin",
    secretAccessKey: STORAGE_SECRET_KEY || "password",
  },
  forcePathStyle: FORCE_PATH_STYLE,
})
