# DOJ-PPA Centralized File System — Codebase Audit & Remediation Plan

**Target Files Audited:** `server.js`, `routes/files.js`, `routes/auth.js`, `utils/sessionStore.js`, `utils/objectStorage.js`, `utils/blockchainTransactionQueue.js`, `utils/onboardingOtp.js`, `config/blockchain.js`, `views/verify-email.ejs`

**Stack:** Node.js / Express, MongoDB (Mongoose), EJS, Socket.IO, Cloudflare R2, Hardhat / Polygon Web3

## 1. Technical Diagnostic (Exact Bugs & Security Flaws)

### A. Critical Security, Auth & Data Integrity Bugs

1. **Cross-Branch IDOR & Missing Ownership/Branch Scoping (`routes/files.js`)**

   * **Location:** File retrieval, preview, download, and share endpoints in `routes/files.js`.

   * **Issue:** Role checks verify authentication (`authMiddleware`) and role tier (`roleMiddleware`), but file lookup queries (`File.findById(req.params.id)`) do not consistently enforce that an `Admin` or `User` belongs to the target file's `branch` (or is explicitly listed in `sharedWith`) before streaming R2 content or generating share links.

   * **Impact:** An authenticated `Admin` or `User` in Branch A can access or enumerate file IDs belonging to Branch B.

2. **Public/Unauthenticated Share Link Exposure (`routes/files.js` & `models/ShareLink.js`)**

   * **Location:** Public share token resolution routes in `routes/files.js`.

   * **Issue:** Share links rely on token lookup without rate limiting on token guessing, mandatory expiration enforcement checks at query time, or download-count atomic increments (`$inc`), allowing race conditions on single-use links and unthrottled brute-force probing.

3. **Unvalidated File Type & Stored XSS Vector (`routes/files.js` & `views/*.ejs`)**

   * **Location:** Multer upload pipeline and in-browser preview endpoints in `routes/files.js`.

   * **Issue:** File type validation trusts client-supplied `file.mimetype` and file extensions rather than inspecting binary magic bytes. Furthermore, inline preview streaming proxies files under the primary application origin, creating a Stored XSS vector if an HTML, SVG, or active PDF payload is rendered inline.

4. **Refresh Token Rotation & Session Desynchronization (`routes/auth.js` & `utils/sessionStore.js`)**

   * **Location:** `/login`, `/refresh`, `/2fa/verify`, and `utils/sessionStore.js`.

   * **Issue:** Active session tracking and Socket.IO presence maps are held in-memory inside `utils/sessionStore.js`, while JWT refresh tokens (`models/RefreshToken.js`) persist in MongoDB. On Render zero-downtime restarts or multi-instance scaling, in-memory session state wipes out, causing false session invalidations, orphaned Socket.IO rooms, and inconsistent auto-logout enforcement.

5. **2FA Bypass / Incomplete Intermediate State Lock (`routes/auth.js`)**

   * **Location:** Password authentication step prior to `/2fa/verify`.

   * **Issue:** When 2FA is enabled on an account, intermediate login state relies on temporary session/cookie flags that must be strictly isolated from full-access JWT scopes so a partial-auth token cannot invoke `/api/*` or `/files/*` endpoints prior to TOTP verification.

6. **Blocking Email Verification Flow on Account Registration (`routes/auth.js`, `models/User.js`, `utils/onboardingOtp.js`, `views/verify-email.ejs`)**

   * **Location:** `POST /register`, email OTP/token verification handlers in `routes/auth.js`, `utils/onboardingOtp.js`, and `views/verify-email.ejs`.

   * **Issue:** New account registration currently forces an email verification/OTP step that depends on external SMTP (`MAIL_HOST`) delivery. When SMTP is unconfigured or throttled in production, newly registered users are locked in an unverified state and cannot log in.

### B. Runtime, Performance & Infrastructure Bugs

7. **Memory Exhaustion via Synchronous Buffer Streaming (`routes/files.js` & `utils/objectStorage.js`)**

   * **Location:** Upload (`multer.memoryStorage()`) and download/preview proxy handlers in `routes/files.js`.

   * **Issue:** Files are buffered into Node.js V8 heap memory during upload and piped through the Express server on Render during every download/preview. Concurrent multi-megabyte uploads/downloads will trigger `FATAL ERROR: Reached heap limit Allocation failed` on Render's standard RAM tiers.

8. **Deprecated Blockchain Network & Public RPC Failure (`config/blockchain.js` & `hardhat.config.js`)**

   * **Location:** Network configuration dictionaries and default RPC URLs.

   * **Issue:** Hardhat and `config/blockchain.js` reference deprecated **Polygon Mumbai (`chainId: 80001`)** and public Polygon RPC endpoints (`rpc-amoy.polygon.technology` / `polygon-rpc.com`), which are sunsetted. Enabling `ENABLE_BLOCKCHAIN=true` causes startup/healthcheck RPC timeouts.

9. **In-Memory Web3 Transaction Queue Nonce Collisions (`utils/blockchainTransactionQueue.js`)**

   * **Location:** `blockchainTransactionQueue.js` transaction dispatcher.

   * **Issue:** Queue state is volatile in process memory. If Render restarts mid-flight or two workers process transactions simultaneously, pending transactions are lost without dead-letter recovery, and Ethereum nonces desynchronize (`nonce too low` / `replacement transaction underpriced`).

10. **Missing Graceful Shutdown & Unhandled Promise Paths (`server.js`)**

    * **Location:** Bottom of `server.js` (`httpServer.listen(...)`).

    * **Issue:** `server.js` lacks `SIGTERM` and `SIGINT` signal handlers to close Socket.IO connections, drain active HTTP requests, flush the blockchain queue, and close the Mongoose connection pool cleanly during Render deployments.

## 2. Senior Full-Stack Execution Plan (30-Year Engineering Standard)

### Phase 1: Emergency Security, Registration & Stability Patches (Days 1–3)

#### 1.1 Remove Email Verification on New Account Registration (`routes/auth.js` & `models/User.js`)

* **Immediate Account Activation:** Update `POST /register` in `routes/auth.js` to create new accounts with `isVerified: true` (or remove the `isVerified` login gate entirely) and immediately issue standard authentication cookies/tokens or redirect straight to `/login` with a success toast—eliminating any SMTP dependency during onboarding.

* **Remove Obsolete Verification Handlers & Artifacts:**

  * Delete email verification/OTP routes (`/verify-email`, `/resend-verification`, `/verify-otp`) from `routes/auth.js` and remove verification checks from `/login`.

  * Remove `utils/onboardingOtp.js`, `views/verify-email.ejs`, and `test/onboarding-otp.test.js` (and strip unused verification token/OTP fields from `models/User.js`).

  * Ensure registration remains protected by strict rate limiting, password complexity validation, and branch assignment rules (or invitation token validation if invite-only registration is active).

#### 1.2 Enforce Strict Branch & ACL Authorization Guard (`middleware/fileAccessMiddleware.js`)

* Create a single centralized authorization middleware for all `/files/:id/*` routes:

  * **Super Admin:** Global access.

  * **Admin:** Allowed **only** if `file.branch.equals(req.user.branch)`.

  * **User:** Allowed **only** if `file.uploadedBy.equals(req.user._id)` OR `file.sharedWith.includes(req.user._id)` (within the same branch).

* Apply atomic MongoDB updates (`findOneAndUpdate` with `$lt: maxDownloads` and `expiresAt: { $gt: new Date() }`) for all `ShareLink` resolutions, and attach `express-rate-limit` to `/share/:token`.

#### 1.3 Harden Upload Validation & Preview Sandboxing (`routes/files.js`)

* Inspect magic bytes using `file-type` before accepting uploads; reject mismatches between declared MIME type and binary signature.

* Force `Content-Disposition: attachment` on all non-whitelisted types and serve inline previews with strict sandboxing headers:

  ```
  Content-Security-Policy: default-src 'none'; sandbox;
  X-Content-Type-Options: nosniff
  
  ```

#### 1.4 Isolate Pre-2FA Authentication Scope (`routes/auth.js` & `middleware/authMiddleware.js`)

* Issue a short-lived (`5m`) scoped JWT with claim `scope: '2fa_pending'` after password verification.

* Explicitly reject `scope: '2fa_pending'` inside `authMiddleware.js` for every route except `POST /auth/2fa/verify` and `POST /auth/logout`.

### Phase 2: Storage Offloading & Zero-Downtime Runtime (Days 4–7)

#### 2.1 Replace Express R2 Proxy with Short-Lived Presigned URLs (`utils/objectStorage.js`)

* Eliminate `multer.memoryStorage()` and binary proxying through Render:

  1. Client requests upload/download authorization from Express (`POST /files/presign-upload` or `GET /files/:id/presign-download`).

  2. Express validates RBAC, creates/verifies metadata, records the audit log, and generates a **60-second Cloudflare R2 Presigned URL** (`@aws-sdk/s3-request-presigner`).

  3. Browser transfers the binary directly to/from Cloudflare R2 edge storage.

#### 2.2 Add Graceful Shutdown & Fail-Fast Boot Validation (`server.js` & `utils/envValidator.js`)

* Abort process startup in `production` if `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, or `JWT_PRIVATE_KEY` are absent.

* Register `SIGTERM` / `SIGINT` handlers in `server.js` to close Socket.IO, stop accepting HTTP connections, wait up to `10s` for active requests, and call `mongoose.connection.close()`.

### Phase 3: Blockchain Modernization & Persistent State (Days 8–12)

#### 3.1 Migrate to Polygon Amoy (`80002`) & Managed RPCs (`config/blockchain.js`)

* Purge all `polygon-mumbai` (`80001`) configurations.

* Configure **Polygon Amoy (`chainId: 80002`)** for staging and **Polygon PoS Mainnet (`chainId: 137`)** for production using a managed RPC provider (Alchemy/Infura/QuickNode) with `ethers.FallbackProvider`.

#### 3.2 Replace Per-Click On-Chain Writes with Hourly Merkle Root Anchoring

* Keep immediate on-chain `FileRegistry.sol` writes strictly for high-value state transitions (`UPLOAD`, `VERSION_UPDATE`, `OWNERSHIP_TRANSFER`).

* Log high-frequency events (`LOGIN`, `VIEW`, `DOWNLOAD`) to MongoDB (`BlockchainAudit` with `status: 'PENDING'`), and run an hourly cron worker that builds a **SHA-256 Merkle Tree** of pending records and anchors only the single Merkle Root on-chain.

#### 3.3 Externalize Session & Socket.IO State to Redis (`utils/sessionStore.js`)

* Replace in-memory `Map` stores in `utils/sessionStore.js` and `utils/socketHandlers.js` with Redis (e.g., Upstash Redis) using `@socket.io/redis-adapter` and `rate-limit-redis`.

### Phase 4: Architecture Refactor & Test Gate (Days 13–15)

1. **Extract Service Layer:** Move business logic out of `routes/files.js` (42 KB), `routes/auth.js` (28 KB), `routes/admin.js` (25 KB), and `routes/superadmin.js` (27 KB) into `services/fileService.js`, `services/authService.js`, and `services/branchService.js`.

2. **Modularize EJS Dashboards:** Split `views/userdashboard.ejs` (123 KB), `views/superadmindashboard.ejs` (58 KB), and `views/admindashboard.ejs` (56 KB) into reusable EJS partials (`views/partials/`) and externalize inline JavaScript into `public/js/dashboards/`.

3. **Clean Repository Hygiene:** Remove tracked build artifacts (`artifacts/`, `cache/`, `.refact/`, `tmp-*.js`) from Git and add integration tests in `test/` covering direct account registration without email verification, cross-branch IDOR prevention, 2FA token scope isolation, and R2 presigned URL generation.