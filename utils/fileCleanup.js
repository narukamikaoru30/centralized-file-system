const logger = require("./logger");
const { deleteObject } = require("./objectStorage");

/**
 * Safely clean up uploaded files with proper logging
 * @param {Array} files - Array of file objects with .filename property
 * @param {String} context - Context description for logging
 * @returns {Object} { cleaned: Number, failed: Array }
 */
async function cleanupUploadFiles(files, context = "upload") {
  if (!Array.isArray(files)) return { cleaned: 0, failed: [] };

  const failed = [];
  let cleaned = 0;

  for (const file of files) {
    if (!file || !file.filename) continue;
    try {
      await deleteObject(file.filename);
      cleaned++;
    } catch (err) {
      logger.error(`[File Cleanup] Failed to delete ${file.filename}`, {
        context,
        error: err.message,
        code: err.code
      });
      failed.push({
        filename: file.filename,
        error: err.message,
        code: err.code
      });
    }
  }

  return { cleaned, failed };
}

/**
 * Safely delete a single file by path
 * @param {String} filepath - Full path to file
 * @param {String} context - Context description for logging
 * @returns {Object} { success: Boolean, error: String|null }
 */
async function deleteFile(filepath, context = "file-operation") {
  try {
    await deleteObject(filepath);
    return { success: true, error: null };
  } catch (err) {
    logger.error(`[File Delete] Failed for ${filepath}`, {
      context,
      error: err.message,
      code: err.code
    });
    return { success: false, error: err.message };
  }
}

module.exports = { cleanupUploadFiles, deleteFile };
