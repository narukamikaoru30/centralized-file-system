/**
 * AI File Categorizer
 * Automatically categorizes files based on MIME type, extension, content signatures,
 * content-based keyword parsing, and user feedback learning.
 */

const fs = require('fs');
const path = require('path');

// Confidence threshold — below this, auto-categorization is skipped
const CONFIDENCE_THRESHOLD = 60;

// Content-based keywords for text-file parsing
const CONTENT_KEYWORDS = {
  report: [
    /\b(total|subtotal|grand total)\b/i,
    /\b(summary|findings|conclusion|recommendation)\b/i,
    /\b(prepared by|submitted by|approved by|reviewed by)\b/i,
    /\b(date of report|reporting period|fiscal year)\b/i,
    /\b(annex|appendix|attachment|enclosure)\b/i,
    /\b(compliance|assessment|evaluation|audit)\b/i,
    /\b(incident report|case report|progress report)\b/i,
    /\b(probationer|parolee|supervision|parole)\b/i,
    /\b(quarterly|monthly|weekly|annual)\s+(report|summary|update)\b/i,
    /\b(table of contents|executive summary)\b/i
  ],
  document: [
    /\b(dear|sincerely|regards|respectfully)\b/i,
    /\b(memorandum|memo|to:|from:|subject:)\b/i,
    /\b(please|kindly|hereby|herewith)\b/i,
    /\b(pursuant to|in accordance with|reference)\b/i
  ]
};

// Learned weight adjustments from user feedback (in-memory cache, populated from DB)
let feedbackWeights = {};
let isLoadingWeights = false;
let weightLoadPromise = null;
const logger = require('../utils/logger');

// Category definitions matching the system's ALLOWED_FILETYPES
const CATEGORY_RULES = {
  document: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'text/html',
      'text/xml',
      'application/xml',
      'application/json',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/epub+zip',
      'application/x-tex',
      'text/markdown'
    ],
    extensions: [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.csv', '.html', '.htm', '.xml', '.json', '.rtf',
      '.odt', '.ods', '.odp', '.epub', '.tex', '.md', '.markdown',
      '.log', '.ini', '.cfg', '.conf', '.yaml', '.yml'
    ],
    priority: 2
  },
  image: {
    mimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/tiff',
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/heic',
      'image/heif',
      'image/avif',
      'image/jxl'
    ],
    extensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
      '.tiff', '.tif', '.ico', '.heic', '.heif', '.avif', '.jxl',
      '.raw', '.cr2', '.nef', '.arw', '.dng'
    ],
    priority: 1
  },
  report: {
    // Reports are typically PDFs or CSVs with specific naming patterns
    mimeTypes: [
      'application/pdf',
      'text/csv',
      'text/plain'
    ],
    extensions: [
      '.pdf', '.csv', '.txt'
    ],
    // Keywords that suggest a file is a report
    namePatterns: [
      // General report patterns
      /report/i,
      /summary/i,
      /analysis/i,
      /statistics/i,
      /monthly/i,
      /weekly/i,
      /daily/i,
      /annual/i,
      /quarterly/i,
      /semi[-_]?annual/i,
      /audit/i,
      /log/i,
      /export/i,
      // Business documents
      /invoice/i,
      /receipt/i,
      /statement/i,
      /memo(randum)?/i,
      /minutes/i,
      /agenda/i,
      /budget/i,
      /financial/i,
      /expenditure/i,
      /disbursement/i,
      /procurement/i,
      /inventory/i,
      /payroll/i,
      // Official documents
      /resolution/i,
      /directive/i,
      /circular/i,
      /memorandum/i,
      /advisory/i,
      /policy/i,
      /guideline/i,
      // PPA-specific patterns
      /case[-_]?(file|report|summary)?/i,
      /probation(er)?/i,
      /parole(e)?/i,
      /assessment/i,
      /evaluation/i,
      /compliance/i,
      /progress[-_]?report/i,
      /investigation/i,
      /surveillance/i,
      /supervision/i,
      /intake/i,
      /release/i,
      /commitment/i,
      /sentence/i,
      /hearing/i,
      /violation/i,
      /incident/i,
      /court[-_]?order/i,
      /legal/i,
      /accomplishment/i,
      // Letterhead patterns
      /letterhead/i,
      /official[-_]?letter/i,
      /correspondence/i,
      /endorsement/i,
      /certification/i,
      /certificate/i,
      /transmittal/i,
      /referral/i
    ],
    priority: 3
  }
};

// File magic bytes (signatures) for additional verification
const MAGIC_SIGNATURES = {
  // PDF
  '25504446': 'document',
  // JPEG
  'ffd8ff': 'image',
  // PNG
  '89504e47': 'image',
  // GIF
  '47494638': 'image',
  // WebP
  '52494646': 'image', // RIFF (WebP starts with RIFF)
  // ZIP-based (DOCX, XLSX, PPTX, ODT, EPUB)
  '504b0304': 'document'
};

/**
 * Get file extension from filename
 * @param {string} filename 
 * @returns {string} Extension in lowercase with dot
 */
function getExtension(filename) {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Categorize file by MIME type
 * @param {string} mimeType 
 * @returns {string|null} Category or null
 */
function categorizeByMimeType(mimeType) {
  if (!mimeType) return null;
  const mime = mimeType.toLowerCase();
  
  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    if (rules.mimeTypes.includes(mime)) {
      return category;
    }
  }
  
  // Fallback: check MIME type prefix
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'document';
  
  return null;
}

/**
 * Categorize file by extension
 * @param {string} filename 
 * @returns {string|null} Category or null
 */
function categorizeByExtension(filename) {
  const ext = getExtension(filename);
  if (!ext) return null;
  
  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    if (rules.extensions.includes(ext)) {
      return category;
    }
  }
  
  return null;
}

/**
 * Categorize file by magic bytes (file signature)
 * @param {Buffer} buffer - First few bytes of the file
 * @returns {string|null} Category or null
 */
function categorizeByMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return null;
  
  const hex = buffer.toString('hex').toLowerCase();
  
  // Check various signature lengths
  for (const [signature, category] of Object.entries(MAGIC_SIGNATURES)) {
    if (hex.startsWith(signature.toLowerCase())) {
      return category;
    }
  }
  
  return null;
}

/**
 * Calculate confidence score for categorization
 * @param {object} results - Object with mime, extension, magic results
 * @returns {number} Confidence 0-100
 */
function calculateConfidence(results) {
  let score = 0;
  let factors = 0;
  
  if (results.byMime) {
    score += 40;
    factors++;
  }
  if (results.byExtension) {
    score += 35;
    factors++;
  }
  if (results.byMagic) {
    score += 25;
    factors++;
  }
  
  // Bonus for agreement
  const categories = [results.byMime, results.byExtension, results.byMagic].filter(Boolean);
  const uniqueCategories = [...new Set(categories)];
  
  if (uniqueCategories.length === 1 && categories.length > 1) {
    score += 15; // All methods agree
  }
  
  return Math.min(100, score);
}

/**
 * Check if filename matches report patterns
 * @param {string} filename 
 * @returns {boolean}
 */
function isLikelyReport(filename) {
  if (!filename) return false;
  const rules = CATEGORY_RULES.report;
  if (!rules || !rules.namePatterns) return false;
  
  return rules.namePatterns.some(pattern => pattern.test(filename));
}

/**
 * Check if filename contains date patterns (files with dates are often reports)
 * @param {string} filename
 * @returns {object} { hasDate: boolean, confidence: number }
 */
function hasDatePattern(filename) {
  if (!filename) return { hasDate: false, confidence: 0 };
  
  const datePatterns = [
    // ISO format: 2026-03-05, 2026_03_05
    /\d{4}[-_]\d{2}[-_]\d{2}/,
    // US format: 03-05-2026, 03_05_2026
    /\d{2}[-_]\d{2}[-_]\d{4}/,
    // Month names: March-2026, Mar2026, March_2026
    /(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)[-_]?\d{4}/i,
    // Year-Month: 2026-March, 2026_Mar
    /\d{4}[-_]?(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)/i,
    // Quarter references: Q1-2026, 1Q2026, 2026Q1
    /[qQ][1-4][-_]?\d{4}|\d{4}[-_]?[qQ][1-4]|[1-4][qQ][-_]?\d{4}/,
    // Fiscal Year: FY2026, FY-2026, FY_2026
    /[fF][yY][-_]?\d{4}/,
    // Week number: Week-10-2026, W10-2026
    /[wW](eek)?[-_]?\d{1,2}[-_]?\d{4}/,
    // Simple year with context: annual_2026, report_2026
    /[-_](19|20)\d{2}[-_.]|^(19|20)\d{2}[-_.]/
  ];
  
  let matchCount = 0;
  for (const pattern of datePatterns) {
    if (pattern.test(filename)) {
      matchCount++;
    }
  }
  
  return {
    hasDate: matchCount > 0,
    confidence: Math.min(matchCount * 15, 30) // Max 30% bonus for date patterns
  };
}

/**
 * Check if filename suggests a letterhead or official document
 * @param {string} filename
 * @returns {boolean}
 */
function isLikelyLetterhead(filename) {
  if (!filename) return false;
  
  const letterheadPatterns = [
    /letterhead/i,
    /letter[-_]?head/i,
    /official[-_]?(letter|doc|document)/i,
    /[A-Z]{2,}[-_]?(letter|memo|circular)/i, // Agency code patterns like "DOJ-letter"
    /^[A-Z]{2,5}[-_]/,  // Files starting with agency codes
    /correspondence/i,
    /legal[-_]?size/i,
    /a4[-_]?size/i,
    /template/i,
    /form[-_]?(letter|doc)/i
  ];
  
  return letterheadPatterns.some(pattern => pattern.test(filename));
}

/**
 * Parse text content for category keywords
 * @param {string} content - Text content from a file (first ~2KB)
 * @returns {object} { category: string|null, keywordHits: number, confidence: number }
 */
function categorizeByContent(content) {
  if (!content || typeof content !== 'string') return { category: null, keywordHits: 0, confidence: 0 };
  const sample = content.slice(0, 2048);

  let bestCategory = null;
  let bestHits = 0;

  for (const [category, patterns] of Object.entries(CONTENT_KEYWORDS)) {
    let hits = 0;
    for (const pattern of patterns) {
      if (pattern.test(sample)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCategory = category;
    }
  }

  const confidence = Math.min(bestHits * 12, 40); // max 40% boost from content
  return { category: bestCategory, keywordHits: bestHits, confidence };
}

/**
 * Read text content from file for keyword analysis (only for text-like files)
 * @param {string} filePath - Path to the uploaded file
 * @param {string} mimeType - MIME type
 * @returns {string|null}
 */
function readTextContent(filePath, mimeType) {
  const textMimes = ['text/plain', 'text/csv', 'text/html', 'text/xml', 'application/json', 'text/markdown'];
  if (!textMimes.includes(mimeType)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 2048);
  } catch (_) {
    return null;
  }
}

/**
 * Load feedback weights from CategoryFeedback collection
 * Aggregates user corrections to bias future categorization
 * Uses locking to prevent concurrent load race conditions
 * @returns {Promise<void>}
 */
async function loadFeedbackWeights() {
  // If already loading, wait for in-flight request
  if (isLoadingWeights && weightLoadPromise) {
    return weightLoadPromise;
  }

  // If not loading, start a new load
  if (!isLoadingWeights) {
    isLoadingWeights = true;
    
    weightLoadPromise = (async () => {
      try {
        const CategoryFeedback = require('../models/CategoryFeedback');
        const pipeline = [
          { $group: {
            _id: { mimeType: '$mimeType', correctedCategory: '$correctedCategory' },
            count: { $sum: 1 }
          }},
          { $sort: { count: -1 } }
        ];
        const results = await CategoryFeedback.aggregate(pipeline);
        const weights = {};
        for (const r of results) {
          const key = r._id.mimeType;
          if (!weights[key]) weights[key] = {};
          weights[key][r._id.correctedCategory] = (weights[key][r._id.correctedCategory] || 0) + r.count;
        }
        // Only update after all data is aggregated (atomic assignment)
        feedbackWeights = weights;
        logger.info('[AI Categorizer] Feedback weights loaded', { mimeTypes: Object.keys(weights).length });
      } catch (err) {
        logger.warn('[AI Categorizer] Failed to load feedback weights', { error: err.message });
      } finally {
        isLoadingWeights = false;
        weightLoadPromise = null;
      }
    })();
  }

  return weightLoadPromise;
}

/**
 * Get feedback-adjusted category for a MIME type
 * @param {string} mimeType
 * @returns {string|null}
 */
function getFeedbackOverride(mimeType) {
  const mimeWeights = feedbackWeights[mimeType];
  if (!mimeWeights) return null;
  let bestCat = null;
  let bestCount = 0;
  for (const [cat, count] of Object.entries(mimeWeights)) {
    if (count > bestCount && count >= 3) { // minimum 3 corrections to override
      bestCount = count;
      bestCat = cat;
    }
  }
  return bestCat;
}

/**
 * Record user feedback/correction for AI categorization
 * @param {object} params
 * @returns {Promise<object>}
 */
async function recordFeedback({ fileId, userId, originalCategory, correctedCategory, confidence, filename, mimeType, branch }) {
  const CategoryFeedback = require('../models/CategoryFeedback');
  const feedback = new CategoryFeedback({
    file: fileId,
    user: userId,
    originalCategory,
    correctedCategory,
    originalConfidence: confidence || 0,
    filename: filename || '',
    mimeType: mimeType || '',
    branch: branch || ''
  });
  await feedback.save();
  // Refresh in-memory weights
  await loadFeedbackWeights();
  return feedback;
}

/**
 * Main categorization function
 * @param {object} fileInfo - File information
 * @param {string} fileInfo.originalname - Original filename
 * @param {string} fileInfo.mimetype - MIME type from upload
 * @param {Buffer} [fileInfo.buffer] - File buffer (optional, for magic byte detection)
 * @param {string} [fileInfo.filePath] - Path to file on disk (for content parsing)
 * @returns {object} Categorization result
 */
function categorizeFile(fileInfo) {
  const { originalname, mimetype, buffer, filePath: diskPath } = fileInfo;
  
  const results = {
    byMime: categorizeByMimeType(mimetype),
    byExtension: categorizeByExtension(originalname),
    byMagic: buffer ? categorizeByMagicBytes(buffer) : null,
    isReportLikeName: isLikelyReport(originalname),
    isLetterhead: isLikelyLetterhead(originalname),
    datePattern: hasDatePattern(originalname),
    byContent: null,
    byFeedback: getFeedbackOverride(mimetype)
  };

  // Content-based keyword parsing (for text files on disk)
  if (diskPath) {
    const textContent = readTextContent(diskPath, mimetype);
    if (textContent) {
      results.byContent = categorizeByContent(textContent);
    }
  }
  
  const reportMimes = CATEGORY_RULES.report.mimeTypes;
  const isReportCompatible = reportMimes.includes(mimetype);
  
  // High-confidence report detection (explicit report pattern)
  if (results.isReportLikeName && isReportCompatible) {
    let confidence = 85;
    let reason = 'Filename matches report pattern';
    
    // Boost confidence if date pattern found too
    if (results.datePattern.hasDate) {
      confidence = Math.min(98, confidence + results.datePattern.confidence);
      reason = 'Filename matches report pattern with date';
    }
    
    return {
      category: 'report',
      confidence,
      details: {
        byMimeType: results.byMime,
        byExtension: results.byExtension,
        byMagicBytes: results.byMagic,
        byNamePattern: true,
        byDatePattern: results.datePattern.hasDate,
        byLetterhead: false,
        originalMime: mimetype,
        originalName: originalname
      },
      isAutoDetected: true,
      reason
    };
  }
  
  // Letterhead detection (categorize as document)
  if (results.isLetterhead) {
    return {
      category: 'document',
      confidence: 88,
      details: {
        byMimeType: results.byMime,
        byExtension: results.byExtension,
        byMagicBytes: results.byMagic,
        byNamePattern: false,
        byDatePattern: results.datePattern.hasDate,
        byLetterhead: true,
        originalMime: mimetype,
        originalName: originalname
      },
      isAutoDetected: true,
      reason: 'Filename matches letterhead/official document pattern'
    };
  }
  
  // Date pattern with report-compatible MIME suggests a report
  if (results.datePattern.hasDate && isReportCompatible) {
    // Stronger signal if filename also has descriptive text
    const hasDescriptiveText = originalname.length > 15 && /[a-zA-Z]{3,}/.test(originalname);
    if (hasDescriptiveText) {
      return {
        category: 'report',
        confidence: 75 + results.datePattern.confidence,
        details: {
          byMimeType: results.byMime,
          byExtension: results.byExtension,
          byMagicBytes: results.byMagic,
          byNamePattern: false,
          byDatePattern: true,
          byLetterhead: false,
          originalMime: mimetype,
          originalName: originalname
        },
        isAutoDetected: true,
        reason: 'File has date pattern and descriptive name'
      };
    }
  }
  
  // Determine final category with priority
  let category = null;
  
  // Check feedback override first (learned from user corrections)
  if (results.byFeedback) {
    category = results.byFeedback;
  } else if (results.byMime) {
    // MIME type is most reliable for uploaded files
    category = results.byMime;
  } else if (results.byExtension) {
    category = results.byExtension;
  } else if (results.byMagic) {
    category = results.byMagic;
  }
  
  // If there's disagreement, use voting or priority
  const votes = {};
  [results.byMime, results.byExtension, results.byMagic].forEach(cat => {
    if (cat) votes[cat] = (votes[cat] || 0) + 1;
  });

  // Content analysis adds a vote if it matched
  if (results.byContent && results.byContent.category && results.byContent.keywordHits >= 2) {
    votes[results.byContent.category] = (votes[results.byContent.category] || 0) + 1;
  }

  // Feedback override adds a strong vote
  if (results.byFeedback) {
    votes[results.byFeedback] = (votes[results.byFeedback] || 0) + 2;
  }
  
  // Find category with most votes
  let maxVotes = 0;
  for (const [cat, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      category = cat;
    }
  }
  
  let confidence = calculateConfidence(results);

  // Boost confidence from content analysis
  if (results.byContent && results.byContent.confidence > 0) {
    confidence = Math.min(100, confidence + results.byContent.confidence);
  }

  // Boost confidence from feedback agreement
  if (results.byFeedback && results.byFeedback === category) {
    confidence = Math.min(100, confidence + 10);
  }

  let reason = 'Detected by ';
  const reasons = [];
  if (results.byFeedback) reasons.push('user feedback');
  if (results.byMime) reasons.push('MIME type');
  if (results.byExtension) reasons.push('extension');
  if (results.byMagic) reasons.push('file signature');
  if (results.byContent && results.byContent.keywordHits > 0) reasons.push('content keywords');
  reason += reasons.join(', ') || 'default';

  const finalCategory = category || 'document';
  
  // Apply confidence threshold — if below threshold, mark as low-confidence
  const belowThreshold = confidence < CONFIDENCE_THRESHOLD;
  
  return {
    category: finalCategory,
    confidence,
    belowThreshold,
    details: {
      byMimeType: results.byMime,
      byExtension: results.byExtension,
      byMagicBytes: results.byMagic,
      byDatePattern: results.datePattern.hasDate,
      byLetterhead: results.isLetterhead,
      byContent: results.byContent,
      byFeedback: results.byFeedback,
      originalMime: mimetype,
      originalName: originalname
    },
    isAutoDetected: !belowThreshold,
    reason: belowThreshold ? `Low confidence (${confidence}%) — manual review suggested` : reason
  };
}

/**
 * Validate if file matches expected category
 * @param {object} fileInfo - File information
 * @param {string} expectedCategory - Expected category
 * @returns {object} Validation result
 */
function validateCategory(fileInfo, expectedCategory) {
  const detected = categorizeFile(fileInfo);
  const matches = detected.category === expectedCategory;
  
  return {
    isValid: matches,
    detected: detected.category,
    expected: expectedCategory,
    confidence: detected.confidence,
    suggestion: matches ? null : `File appears to be ${detected.category}, not ${expectedCategory}`
  };
}

/**
 * Get all supported categories
 * @returns {string[]} Array of category names
 */
function getSupportedCategories() {
  return Object.keys(CATEGORY_RULES);
}

/**
 * Get allowed MIME types for a category
 * @param {string} category 
 * @returns {string[]} Array of MIME types
 */
function getAllowedMimeTypes(category) {
  const rules = CATEGORY_RULES[category];
  return rules ? rules.mimeTypes : [];
}

/**
 * Get allowed extensions for a category
 * @param {string} category 
 * @returns {string[]} Array of extensions
 */
function getAllowedExtensions(category) {
  const rules = CATEGORY_RULES[category];
  return rules ? rules.extensions : [];
}

module.exports = {
  categorizeFile,
  validateCategory,
  categorizeByMimeType,
  categorizeByExtension,
  categorizeByMagicBytes,
  categorizeByContent,
  isLikelyReport,
  isLikelyLetterhead,
  hasDatePattern,
  getSupportedCategories,
  getAllowedMimeTypes,
  getAllowedExtensions,
  loadFeedbackWeights,
  recordFeedback,
  CATEGORY_RULES,
  CONFIDENCE_THRESHOLD,
  CONTENT_KEYWORDS
};
