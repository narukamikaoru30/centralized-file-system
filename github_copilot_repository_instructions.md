# GitHub Copilot Instructions — DOJ-PPA Centralized File System

You are working on the **Department of Justice – Philippine Parole and Probation Administration (DOJ-PPA)** Centralized File System. Follow these architectural, security, and coding conventions strictly across all edits.

---

## 1. Tech Stack & Runtime Environment
- **Backend:** Node.js (v18+), Express.js (CommonJS `require`/`module.exports`), Socket.IO
- **Database:** MongoDB (v6+) via Mongoose ODM (`models/`)
- **Object Storage:** Cloudflare R2 via AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) in `utils/objectStorage.js`
- **Frontend:** Server-rendered EJS templates (`views/`) + Vanilla ES6 JavaScript (`public/js/`) + Custom CSS (`public/css/`)
- **Blockchain (Optional):** Solidity (`contracts/FileRegistry.sol`), Hardhat, Ethers.js targeting **Polygon Amoy (`chainId: 80002`)** and **Polygon PoS Mainnet (`chainId: 137`)**
- **Testing:** Mocha + Chai (`npm test`)

---

## 2. Core Architectural Rules
1. **Thin Routes, Fat Services:**
   - Route files (`routes/*.js`) must only parse/validate input, enforce auth/RBAC middleware, call a service in `services/`, and return a JSON response or render an EJS template.
   - Never put raw Mongoose aggregations, R2 SDK calls, or Web3 contract logic directly inside route handlers.
2. **Zero Ephemeral Disk Usage in Production:**
   - Render's local filesystem is ephemeral. When `NODE_ENV === 'production'`, **never** write uploaded files, avatars, or backups to local `uploads/` directories. All binary assets must go through Cloudflare R2.
3. **Presigned URLs Over Binary Proxying:**
   - Do not buffer multi-megabyte uploads in RAM (`multer.memoryStorage()`) or pipe binary downloads through Express. Authorize the request in Express, log the audit trail, and return short-lived (`<= 60s`) Cloudflare R2 presigned URLs.
4. **Centralized Async Error Handling:**
   - Wrap all async route handlers with `utils/asyncHandler.js` and forward errors to `utils/errorHandler.js`. Log operational errors via `utils/logger.js` instead of raw `console.log`.

---

## 3. Authentication, Authorization & Security Guardrails
1. **Immediate Registration (No Email Verification):**
   - New account registration (`POST /register`) must activate accounts immediately (`isVerified: true`, `isActive: true`) without sending or requiring an OTP/verification email. Keep SMTP email logic strictly for password resets and admin invitations.
2. **Strict Branch-Scoped RBAC:**
   - Every file, user, and audit query **must** enforce role and branch boundaries:
     - `Super Admin`: Global access across all branches.
     - `Admin`: Strictly scoped to `req.user.branch`.
     - `User`: Strictly scoped to files owned by `req.user._id` or explicitly listed in `sharedWith` within `req.user.branch`.
   - Never execute `File.findById(id)` without verifying branch/ownership permissions before returning metadata or generating R2 URLs.
3. **2FA Token Scope Isolation:**
   - Intermediate pre-2FA tokens (`scope: '2fa_pending'`) must be rejected by `middleware/authMiddleware.js` on all routes except `POST /auth/2fa/verify` and `POST /auth/logout`.
4. **CSRF, Headers & XSS Prevention:**
   - Preserve `middleware/csrfMiddleware.js` on all state-changing routes.
   - Validate uploaded file types via binary magic bytes (`file-type`), not just `file.mimetype`. Serve inline file previews with `X-Content-Type-Options: nosniff` and sandboxed CSP headers.
   - Never expose password hashes, TOTP secrets, refresh tokens, or private keys in API responses or logs.

---

## 4. Database & State Management Conventions
- Always use `lean()` on read-only Mongoose queries rendered in EJS dashboards or exported to CSV.
- Use atomic MongoDB operators (`$inc`, `findOneAndUpdate` with conditional filters) for share-link download counters, token rotation, and quota checks.
- Do not rely on process-local `Map` or `Set` objects for persistent state in production; use Redis (`REDIS_URL`) when configured, with an in-memory fallback for local development.

---

## 5. Blockchain & Web3 Rules
- Never reference deprecated Polygon Mumbai (`80001`) or hardcoded public Polygon RPC URLs. Use `process.env.BLOCKCHAIN_RPC_URL` with Polygon Amoy (`80002`) or Mainnet (`137`).
- Guard all blockchain calls behind `process.env.ENABLE_BLOCKCHAIN === 'true'`. A disabled or unreachable RPC node must never crash Express startup or block file uploads.
- Only anchor critical state transitions (`UPLOAD`, `VERSION_UPDATE`, `OWNERSHIP_TRANSFER`) or periodic Merkle roots on-chain; store high-frequency actions (`LOGIN`, `VIEW`, `DOWNLOAD`) in MongoDB `AuditLog` / `BlockchainAudit`.

---

## 6. Frontend (EJS & Vanilla JS) Conventions
- Keep EJS templates modular: place reusable modals, tables, and navigation components in `views/partials/`.
- Keep JavaScript out of `.ejs` files; place page-specific scripts in `public/js/` and always attach CSRF tokens using `public/js/requestHelpers.js`.
- Preserve existing DOM IDs, `data-*` attributes, and toast notification hooks (`public/js/toast.js`) when refactoring views.

---

## 7. Verification Workflow Before Finishing Any Task
1. Run `npm test` and confirm all Mocha/Chai suites pass.
2. Verify no secrets, `.pem` keys, `tmp-*` scripts, or `uploads/` files are staged in Git.
3. Confirm both `ENABLE_BLOCKCHAIN=false` and `NODE_ENV=production` validation checks pass without throwing unhandled rejections.