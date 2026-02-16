import { S3Client } from "@aws-sdk/client-s3"

export const BUCKET_NAME = process.env.S3_BUCKET_NAME || "uploads"
export const STORAGE_PUBLIC_URL = process.env.S3_PUBLIC_URL || "http://localhost:9000"
const STORAGE_REGION = process.env.S3_REGION || "us-east-1"
const FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true"

export const s3 = new S3Client({
  region: STORAGE_REGION,
  endpoint: process.env.S3_ENDPOINT || "http://minio:9000",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "admin",
    secretAccessKey: process.env.S3_SECRET_KEY || "password",
  },
  forcePathStyle: FORCE_PATH_STYLE
})
