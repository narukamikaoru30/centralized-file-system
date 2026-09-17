# Centralized File System — DOJ-PPA

A web-based centralized file management system built for the Department of Justice – Philippine Parole and Probation Administration. It supports multi-branch file uploads, role-based access (User / Admin / Super Admin), real-time messaging, audit logging, and two-factor authentication.

---

## Features

- **Role-Based Access Control** — User, Admin, and Super Admin roles with branch-scoped permissions
- **File Management** — Upload, view, download, share, tag, and soft-delete files with version history
- **AI File Categorization** — Automatic file type classification on upload
- **Two-Factor Authentication (2FA)** — TOTP-based 2FA via authenticator apps
- **Real-Time Messaging** — Socket.IO-powered chat between users
- **Push Notifications** — Web push via VAPID keys
- **Audit Logging** — All actions logged with IP, user agent, and timestamps
- **Dark Mode** — Toggle between light and dark themes
- **Excel/Document Preview** — In-browser preview for Excel, Word, PDF, and image files
- **Branch Management** — Super admin can create, update, and assign admins to branches
- **JWT Authentication** — RS256 asymmetric key signing with refresh token rotation

---

## Prerequisites

- **Node.js** v18 or later
- **MongoDB** v6 or later (local or Atlas)
- **Git**

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/centralized-file-system.git
cd centralized-file-system
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and configure at minimum:

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | Server port | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/centralize_file_system` |
| `ENABLE_DEFAULT_SUPERADMIN_SEED` | Set `true` on first run to create the super admin account | `true` |
| `DEFAULT_SUPERADMIN_EMAIL` | Super admin email | `superadmin@doj-ppa.gov.ph` |
| `DEFAULT_SUPERADMIN_PASSWORD` | Super admin password (min 8 chars, must include uppercase, lowercase, number, special char) | `SuperAdmin@2026!` |

### 4. Generate JWT keys

```bash
npm run jwt:keys
```

This creates `config/keys/jwt-private.pem` and `config/keys/jwt-public.pem`. If they already exist, the script will skip generation.

### 5. Start MongoDB

Make sure MongoDB is running locally:

```bash
mongod
```

Or set `MONGO_URI` to your Atlas connection string.

### 6. Run the server

```bash
npm start
```

The server starts at `http://127.0.0.1:3000` (or your configured `PORT`).

### 7. Create the Super Admin account

On the first run with `ENABLE_DEFAULT_SUPERADMIN_SEED=true`, the system automatically creates the super admin account. After the account is created, set it back to `false`:

```
ENABLE_DEFAULT_SUPERADMIN_SEED=false
```

## Deploy to Render with Atlas and Cloudflare R2

This repository includes [render.yaml](render.yaml) for a Render web service. The service uses MongoDB Atlas for metadata and Cloudflare R2 for uploaded files and profile photos. Render's local filesystem is not used for application files in production.

1. Create an Atlas database user and database, then copy the `mongodb+srv://...` connection string into Render as `MONGO_URI`. Allow Render to connect in Atlas Network Access. For a basic Render deployment this is commonly `0.0.0.0/0` protected by a strong database password; use fixed outbound IPs if your Render plan provides them.
2. In Cloudflare R2, create a bucket and an API token with Object Read and Object Write permission for that bucket. Set `R2_ENDPOINT` to `https://<account-id>.r2.cloudflarestorage.com`, plus `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PREFIX=uploads`.
3. Generate the JWT pair locally with `npm run jwt:keys`. Put the contents of the PEM files into Render's `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` variables, preserving line breaks or using `\\n` escapes. Set a stable `JWT_ACTIVE_KID` value.
4. Create a Render Blueprint from this repository, or create a Node web service with build command `npm ci`, start command `npm start`, and health check path `/healthz`. Set all `sync: false` variables in `render.yaml` in Render's Environment settings.
5. Leave `ENABLE_BLOCKCHAIN=false` until the Polygon RPC URL, contract address, and wallet key are configured in Render. Never commit the wallet key or any R2, Atlas, mail, or JWT secret.

The application keeps file authorization in Express and proxies private R2 objects through authenticated routes, so the R2 bucket does not need to be public.

---

## Usage

### Logging In

Navigate to `http://localhost:3000` — you'll be redirected to the login page.

### Roles

| Role | Access |
|---|---|
| **Super Admin** | Full system control — manage admins, branches, all files, system settings, audit logs |
| **Admin** | Manage users and files within their assigned branch |
| **User** | Upload, view, download, and share files within their branch |

### Super Admin Dashboard

- **Manage Admins** — Create admin accounts, assign to branches, reset passwords, deactivate
- **Manage Branches** — Add/edit/delete branches, seed default branches
- **View All Files** — Browse, view, download, or delete any file across all branches
- **Audit Logs** — View system-wide activity logs
- **System Settings** — Configure auto-logout timer and other global settings

### Admin Dashboard

- **Manage Files** — View, download, delete files in your branch
- **Manage Users** — Deactivate users, invite new users via email
- **User Uploads** — Review files uploaded by users in your branch
- **Audit Logs** — View branch-scoped activity

### User Dashboard

- **Upload Files** — Drag & drop or select files (PDF, DOCX, Excel, images)
- **File Tags** — Add comma-separated tags for organization
- **Version History** — Re-uploading a file with the same name creates a new version
- **Share Files** — Share with other users by email
- **Preview** — In-browser preview for supported file types
- **Dark Mode** — Toggle via the sidebar button

---

## Project Structure

```
├── server.js              # Express app entry point
├── config/
│   ├── mongo.js           # MongoDB connection
│   └── keys/              # JWT RSA key pair (gitignored)
├── middleware/
│   ├── authMiddleware.js   # JWT authentication
│   ├── roleMiddleware.js   # Role & active-status checks
│   ├── csrfMiddleware.js   # CSRF protection
│   └── sessionMiddleware.js
├── routes/
│   ├── auth.js            # Login, register, 2FA, password reset
│   ├── admin.js           # Admin operations
│   ├── superadmin.js      # Super admin operations
│   ├── dashboard.js       # Dashboard rendering
│   ├── files.js           # File CRUD, sharing, preview
│   ├── profile.js         # User profile, avatar, password change
│   ├── messages.js        # Real-time messaging
│   └── notifications.js   # Push notifications
├── models/                # Mongoose schemas
├── views/                 # EJS templates
├── public/                # Static assets (CSS, JS, images)
├── uploads/               # Uploaded files (gitignored)
├── ai/                    # AI file categorization
├── utils/                 # Helpers (logger, encryption, JWT, etc.)
├── scripts/               # CLI utilities
│   ├── generate-jwt-keys.js
│   ├── backup.js
│   └── start-clean.js
└── test/                  # Mocha/Chai tests
```

---

## NPM Scripts

| Command | Description |
|---|---|
| `npm start` | Start the server |
| `npm run start:clean` | Start with a clean state |
| `npm run jwt:keys` | Generate RS256 JWT key pair |
| `npm test` | Run tests |
| `npm run backup` | Backup database |

---

## Optional Configuration

### Web Push Notifications

Generate VAPID keys and add to `.env`:

```bash
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=<your-public-key>
VAPID_PRIVATE_KEY=<your-private-key>
VAPID_CONTACT=mailto:admin@doj-ppa.gov.ph
```

### Email (Password Reset)

Configure SMTP for email-based password reset:

```
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
MAIL_FROM=noreply@doj-ppa.gov.ph
```

> Without email configured, password reset links are shown in the browser (development mode only).

### Two-Factor Authentication

Users can enable 2FA from their profile settings. Scan the QR code with any TOTP authenticator app (Google Authenticator, Authy, etc.).

---

## Security

- RS256 JWT with automatic key generation
- Bcrypt password hashing (12 rounds)
- CSRF protection on all state-changing routes
- Rate limiting on login, register, 2FA, and password reset
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- HTTPS redirect enforcement in production
- Refresh token rotation with family-based reuse detection
- Sensitive fields excluded from API responses

---

## 🔗 Blockchain Integration (NEW!)

This system now includes **full blockchain integration** for immutable audit trails and compliance:

### Key Features:
- **Smart Contract (Polygon)** — FileRegistry.sol for file ownership and permissions
- **Immutable Audit Trail** — All operations (upload, download, share, delete, login, role changes) recorded on-chain
- **File Integrity Verification** — SHA-256 hashes anchored on blockchain
- **Permission Management** — Ownership transfer and 5-tier access control enforced by smart contract
- **Compliance Ready** — Blockchain-backed audit logs for regulatory requirements
- **Non-Breaking Integration** — Works alongside existing username/password authentication

### Quick Start:
```bash
# 1. Get testnet MATIC from faucet
# Visit: https://faucet.polygon.technology/

# 2. Update .env with your wallet
BLOCKCHAIN_NETWORK=polygon-mumbai
WALLET_PRIVATE_KEY=0xYOUR_KEY

# 3. Deploy contract
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai

# 4. Start server
npm start

# 5. Check blockchain status
curl http://localhost:3000/api/blockchain/health
```

### Documentation:
- **[BLOCKCHAIN_QUICK_REFERENCE.md](./BLOCKCHAIN_QUICK_REFERENCE.md)** — Quick commands and reference
- **[BLOCKCHAIN_IMPLEMENTATION.md](./BLOCKCHAIN_IMPLEMENTATION.md)** — Technical architecture
- **[BLOCKCHAIN_DEPLOYMENT_GUIDE.md](./BLOCKCHAIN_DEPLOYMENT_GUIDE.md)** — Step-by-step setup

### Blockchain Statistics:
- **Smart Contract**: 550 lines of Solidity
- **Web3 Integration**: 1,380+ lines of JavaScript
- **API Endpoints**: 15 REST endpoints for monitoring and control
- **Network**: Polygon Mainnet (chainId 137) or Mumbai Testnet (chainId 80001)
- **Status**: ✅ Production-ready, testnet deployment ready

---

## License

ISC
