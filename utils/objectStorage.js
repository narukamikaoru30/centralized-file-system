const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { Upload } = require("@aws-sdk/lib-storage");
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

async function uploadStream({ filename, stream, contentType }) {
  if (hasR2Config) {
    const upload = new Upload({
      client,
      params: {
        Bucket: process.env.R2_BUCKET,
        Key: objectKey(filename),
        Body: stream,
        ContentType: contentType || "application/octet-stream"
      }
    });
    await upload.done();
    return;
  }

  await fs.promises.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  await pipeline(stream, fs.createWriteStream(path.join(LOCAL_UPLOADS_DIR, path.basename(filename))));
}

async function getObjectStream(filename) {
  if (hasR2Config) {
    const response = await client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey(filename)
    }));
    return response.Body;
  }

  return fs.createReadStream(path.join(LOCAL_UPLOADS_DIR, path.basename(filename)));
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

async function createTempFile(filename, maxBytes = 0) {
  const tempPath = path.join(os.tmpdir(), `centralized-file-${crypto.randomUUID()}-${path.basename(filename)}`);
  let totalBytes = 0;
  const sizeGuard = new Transform({
    transform(chunk, encoding, callback) {
      totalBytes += chunk.length;
      if (maxBytes > 0 && totalBytes > maxBytes) {
        const error = new Error("Object exceeds the maximum processing size");
        error.code = "MAX_OBJECT_SIZE";
        return callback(error);
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(await getObjectStream(filename), sizeGuard, fs.createWriteStream(tempPath));
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
  return tempPath;
}

module.exports = {
  hasR2Config,
  createStorageFilename,
  putObject,
  uploadStream,
  getObjectStream,
  getObjectBuffer,
  getObjectMetadata,
  deleteObject,
  objectExists,
  createTempFile
};
