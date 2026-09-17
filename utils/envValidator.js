// utils/envValidator.js
// Validates required environment variables on startup

const REQUIRED_VARS = [
  'MONGO_URI',
  'JWT_ACTIVE_KID'
];

const OPTIONAL_VARS_WITH_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: '3000',
  HOST: '127.0.0.1',
  JWT_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '604800',
  JWT_ISSUER: 'centralized-file-system',
  JWT_AUDIENCE: 'centralized-file-system-web',
  JWT_CLOCK_TOLERANCE_SECONDS: '90',
  UPLOAD_DUPLICATE_WINDOW_MINUTES: '10'
};

function validateEnv() {
  const missing = [];
  const warnings = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName] || process.env[varName].trim() === '') {
      missing.push(varName);
    }
  }

  for (const [varName, defaultVal] of Object.entries(OPTIONAL_VARS_WITH_DEFAULTS)) {
    if (!process.env[varName]) {
      process.env[varName] = defaultVal;
      warnings.push(`${varName} not set, using default: ${defaultVal}`);
    }
  }

  // Validate MONGO_URI format
  if (process.env.MONGO_URI && !process.env.MONGO_URI.startsWith('mongodb')) {
    missing.push('MONGO_URI (invalid format — must start with mongodb:// or mongodb+srv://)');
  }

  // Validate PORT is a number
  if (process.env.PORT && isNaN(Number(process.env.PORT))) {
    missing.push('PORT (must be a valid number)');
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    const r2Vars = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
    for (const varName of r2Vars) {
      if (!process.env[varName] || process.env[varName].trim() === '') {
        missing.push(varName);
      }
    }

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      warnings.push('VAPID keys not set — Web Push disabled in production');
    }
    if (!process.env.MAIL_HOST) {
      warnings.push('MAIL_HOST not set — email features will fail in production');
    }
  }

  return { missing, warnings, isValid: missing.length === 0 };
}

function enforceEnv() {
  const { missing, warnings, isValid } = validateEnv();

  for (const w of warnings) {
    console.warn(`⚠️ ENV: ${w}`);
  }

  if (!isValid) {
    console.error('❌ Missing required environment variables:');
    for (const m of missing) {
      console.error(`   - ${m}`);
    }
    console.error('💡 Copy .env.example to .env and fill in the required values.');
    process.exit(1);
  }

  console.log('✅ Environment variables validated');
}

module.exports = { validateEnv, enforceEnv };
