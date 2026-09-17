const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

const LOCAL_UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const hasR2Config = Boolean(
  process.env.R2_ENDPOINT &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

const client = hasR2Config
  ? new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

function objectKey(filename) {
  const prefix = (process.env.R2_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${filename}` : filename;
}

function createStorageFilename(originalName) {
  const base = path.basename(originalName || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}`;
}

async function putObject({ filename, body, contentType }) {
  if (hasR2Config) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey(filename),
      Body: body,
      ContentType: contentType || "application/octet-stream"
    }));
    return;
  }

  await fs.promises.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(LOCAL_UPLOADS_DIR, path.basename(filename)), body);
}

async function getObjectBuffer(filename) {
  if (hasR2Config) {
    const response = await client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey(filename)
    }));
    return Buffer.from(await response.Body.transformToByteArray());
  }

  return fs.promises.readFile(path.join(LOCAL_UPLOADS_DIR, path.basename(filename)));
}

async function getObjectMetadata(filename) {
  if (hasR2Config) {
    return client.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey(filename)
    }));
  }

  const stats = await fs.promises.stat(path.join(LOCAL_UPLOADS_DIR, path.basename(filename)));
  return { ContentLength: stats.size };
}

async function deleteObject(filename) {
  if (!filename) return;
  if (hasR2Config) {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey(filename)
    }));
    return;
  }

  try {
    await fs.promises.unlink(path.join(LOCAL_UPLOADS_DIR, path.basename(filename)));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function objectExists(filename) {
  try {
    await getObjectMetadata(filename);
    return true;
  } catch (err) {
    if (["ENOENT", "NotFound", "NoSuchKey"].includes(err.code) || err.name === "NotFound") return false;
    throw err;
  }
}

async function createTempFile(filename) {
  const tempPath = path.join(os.tmpdir(), `centralized-file-${crypto.randomUUID()}-${path.basename(filename)}`);
  await fs.promises.writeFile(tempPath, await getObjectBuffer(filename));
  return tempPath;
}

module.exports = {
  hasR2Config,
  createStorageFilename,
  putObject,
  getObjectBuffer,
  getObjectMetadata,
  deleteObject,
  objectExists,
  createTempFile
};
