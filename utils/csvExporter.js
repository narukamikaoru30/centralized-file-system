const CSV_HEADERS = [
  "Record Type",
  "Subject / File",
  "Action / Event",
  "Timestamp",
  "User / Actor",
  "Branch",
  "Status"
];

function sanitizeCsvValue(value) {
  const text = value == null ? "" : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function createCsv(rows = []) {
  const lines = [CSV_HEADERS.map(sanitizeCsvValue).join(",")];
  for (const row of rows) {
    lines.push([
      row.recordType,
      row.subject,
      row.action,
      row.timestamp,
      row.actor,
      row.branch,
      row.status
    ].map(sanitizeCsvValue).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

module.exports = {
  CSV_HEADERS,
  sanitizeCsvValue,
  createCsv
};
