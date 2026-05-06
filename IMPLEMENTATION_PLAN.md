# TrafficPay Implementation Plan

> Based on `TrafficPay_NestJS_System_Design.md` v1.3.0
> Estimated file count: ~70 source files across 16 phases

---

## Dependency Graph (Why This Order)

```
Phase 0: Scaffold ──> Phase 1: Common Layer ──> Phase 2: Entities + Migration
                                                        |
                                                        v
                                           Phase 3: PaystackModule (shared)
                                                        |
                                                        v
                                              Phase 4: UsersModule
                                                   /          \
                                                  v            v
                                    Phase 5: WalletModule   Phase 6: AuthModule
                                    (internal ops only)     (depends on Users,
                                          |                  Wallet, Referrals)
                                          |                      |
                                          v                      |
                                Phase 7: CampaignsModule         |
                                (depends on Wallet escrow)       |
                                          |                      |
                                          v                      |
                                  Phase 8: VisitsModule  <-------+
                                  (depends on Wallet, Campaigns)
                                          |
                              +-----------+-----------+
                              |           |           |
                              v           v           v
                   Phase 9:        Phase 10:     Phase 11:
                   Deposits        Withdrawals   ReferralsModule
                              |           |           |
                              +-----------+-----------+
                                          |
                                          v
                                Phase 12: BullMQ Processors
                                          |
                              +-----------+-----------+
                              |           |           |
                              v           v           v
                   Phase 13:       Phase 14:     Phase 15:
                   Webhooks        Platform      AdminModule
                                                      |
                                                      v
                                              Phase 16: Testing
```

---

## Phase 0 — Project Scaffold + Infrastructure

**Goal:** A running NestJS app that connects to PostgreSQL and Redis, with all dependencies installed.

### Steps

1. Scaffold the NestJS project:
   ```bash
   nest new traffic-pay --strict --package-manager npm
   ```

2. Install all dependencies:
   ```bash
   # Core
   npm i @nestjs/config @nestjs/typeorm typeorm pg
   npm i @nestjs/passport passport passport-jwt @nestjs/jwt
   npm i @nestjs/throttler
   npm i @nestjs/cache-manager cache-manager cache-manager-redis-yet redis
   npm i @nestjs/bullmq bullmq
   npm i class-validator class-transformer
   npm i helmet @nestjs/swagger swagger-ui-express
   npm i nanoid@3 bcrypt
   npm i -D @types/passport-jwt @types/bcrypt
   ```

3. Create files:
   - `src/config/configuration.ts` — central config factory (copy from design doc section 12)
   - `src/main.ts` — bootstrap with rawBody, CORS, helmet, swagger, global prefix (section 13)
   - `src/app.module.ts` — shell with ConfigModule, TypeOrmModule, ThrottlerModule, BullModule, CacheModule (section 2.1)
   - `.env` — from the environment variables template (section 12)
   - `.env.example` — same but with placeholder values

### Implementation Notes

- **nanoid v3, not v5:** v5 is ESM-only and breaks CommonJS NestJS. Pin `nanoid@3`.
- **`app.module.ts` providers:** Register `APP_GUARD`, `APP_FILTER`, `APP_INTERCEPTOR`, `APP_PIPE` even though the classes don't exist yet — just comment them out. Wire them in Phase 1.
- **`main.ts` ordering matters:** The `express.raw()` middleware for webhooks MUST be registered before `app.setGlobalPrefix('v1')` because Express middleware doesn't know about NestJS prefixes. The path must be `/v1/webhooks/paystack`.
- **TypeORM config:** `synchronize: false` always. Never auto-sync. Migrations only.

### Checkpoint
`npm run start:dev` boots without errors. Connects to PostgreSQL and Redis (or fails gracefully with clear connection error).

---

## Phase 1 — Common Layer (Enums, Guards, Decorators, Filters, Pipes, Interceptors)

**Goal:** All cross-cutting concerns are in place before any module touches them.

### Files to Create

```
src/common/
  enums/
    role.enum.ts                    — USER, ADMIN
    campaign-status.enum.ts         — PENDING_REVIEW, ACTIVE, PAUSED, COMPLETED, REJECTED
    campaign-type.enum.ts           — BLOG, YOUTUBE
    pricing-tier.enum.ts            — ECONOMY, STANDARD, PREMIUM
    visit-status.enum.ts            — IN_PROGRESS, COMPLETED, ABANDONED
    transaction-type.enum.ts        — DEPOSIT, WITHDRAWAL, EARNING, REFERRAL_BONUS, CAMPAIGN_ESCROW
    transaction-status.enum.ts      — PENDING, SUCCESSFUL, FAILED
    withdrawal-status.enum.ts       — PROCESSING, COMPLETED, FAILED
    payment-method.enum.ts          — CARD, BANK_TRANSFER (used in InitializeDepositDto)
  decorators/
    public.decorator.ts             — @Public()
    roles.decorator.ts              — @Roles('admin')
    current-user.decorator.ts       — @CurrentUser()
    requires-deposit.decorator.ts   — @RequiresDeposit()
  guards/
    jwt-auth.guard.ts               — extends AuthGuard('jwt'), checks @Public() metadata
    block.guard.ts                  — reads request.user.isBlocked
    roles.guard.ts                  — reads @Roles() metadata via Reflector
    deposit.guard.ts                — reads @RequiresDeposit() metadata via Reflector
  filters/
    http-exception.filter.ts        — global catch-all, shapes { success, error }
  interceptors/
    response.interceptor.ts         — wraps success responses in { success: true, data }
  pipes/
    validation.pipe.ts              — class-validator config (whitelist, forbidNonWhitelisted, transform)
```

### Implementation Notes

- **Guard registration order in `app.module.ts` matters.** NestJS executes `APP_GUARD` providers in the order they appear in the `providers` array. Must be: ThrottlerGuard, JwtAuthGuard, BlockGuard, RolesGuard, DepositGuard.
- **`JwtAuthGuard`** must check for `@Public()` metadata and skip auth if present. This is not the default Passport behavior — override `canActivate()` to check `isPublic` via Reflector before calling `super.canActivate()`.
- **`DepositGuard`** must check the `requiresDeposit` metadata first. If the metadata is absent, return `true` immediately. Only enforce the deposit check on routes explicitly decorated with `@RequiresDeposit()`.
- **`HttpExceptionFilter`** should log non-HTTP exceptions (unexpected errors) at ERROR level for debugging. Don't expose internal error details to the client.
- **`ValidationPipe`** in `app.module.ts` should be configured with `transform: true` so DTO properties are auto-cast to their declared types (e.g., string query params to numbers).

### Checkpoint
Wire all guards/filters/interceptors/pipes into `app.module.ts` providers. Create a temporary test controller with `@Public()` and one protected route. Verify: public route returns `{ success: true, data: ... }`, protected route returns 401, invalid body returns 400 with `{ success: false, error: { code: 'VALIDATION_ERROR', ... } }`.

---

## Phase 2 — Database Entities + Initial Migration

**Goal:** All 9 tables exist in PostgreSQL with correct types, constraints, indexes, and foreign keys.

### Files to Create

```
src/modules/
  auth/entities/refresh-token.entity.ts
  users/entities/user.entity.ts
  campaigns/entities/campaign.entity.ts
  visits/entities/visit.entity.ts
  wallet/entities/wallet.entity.ts
  wallet/entities/transaction.entity.ts
  wallet/entities/bank-account.entity.ts
  wallet/entities/withdrawal.entity.ts
  referrals/entities/referral.entity.ts
```

### Migration Order (FK constraints)

Generate a single initial migration. TypeORM will resolve the creation order, but be aware of the dependency chain:
```
users (no FK deps)
  -> wallets (FK userId -> users)
  -> refresh_tokens (FK userId -> users, CASCADE delete)
  -> campaigns (FK advertiserId -> users, FK reviewedById -> users)
  -> bank_accounts (FK userId -> users)
  -> referrals (FK referrerId -> users, FK refereeId -> users)
  -> transactions (FK walletId -> wallets)
  -> visits (FK userId -> users, FK campaignId -> campaigns)
  -> withdrawals (FK userId -> users, FK bankAccountId -> bank_accounts,
                   FK transactionId -> transactions, FK processedById -> users)
```

After the initial migration, create a second migration with raw SQL for the partial unique index:

```sql
CREATE UNIQUE INDEX idx_visit_user_campaign_completed
  ON visits ("userId", "campaignId") WHERE status = 'completed';
```

### Implementation Notes

- **BigInt gotcha:** PostgreSQL `bigint` columns return **strings** in JavaScript via node-postgres. TypeORM does NOT auto-convert them. Add a column transformer on every `bigint` column:
  ```typescript
  @Column('bigint', {
    default: 0,
    transformer: { to: (value: number) => value, from: (value: string) => parseInt(value, 10) },
  })
  balance: number;
  ```
  Extract this into a reusable `bigintTransformer` in `src/common/transformers/bigint.transformer.ts` to avoid repetition across all 9 bigint columns (Wallet.balance, Wallet.totalEarned, Wallet.totalWithdrawn, Campaign.payPerVisit, Campaign.budget, Campaign.spent, Transaction.amount, Visit.earned, Withdrawal.amount, Referral.totalEarned).

- **Enum columns:** TypeORM's `{ type: 'enum', enum: MyEnum }` creates a real PostgreSQL ENUM type. This is correct and desired — it gives DB-level validation.

- **`@JoinColumn` on every FK:** Every column that acts as a foreign key must have an explicit `@ManyToOne` + `@JoinColumn({ name: 'columnName' })`. Without `@JoinColumn`, TypeORM creates the FK column automatically with its own naming convention, leading to column duplication or mismatches. This was a design doc issue we fixed — verify every entity has it.

- **`User.referredById` self-reference:** This needs a `@ManyToOne(() => User)` and `@JoinColumn({ name: 'referredById' })` even though it's nullable and there's no inverse `@OneToMany`. Add it.

### Checkpoint
```bash
npm run migration:generate -- src/database/migrations/InitialSchema
npm run migration:run
```
Verify all 9 tables exist with correct columns, types, and foreign keys using `\d+ table_name` in psql. Verify the partial unique index exists on `visits`.

---

## Phase 3 — PaystackModule (Shared)

**Goal:** A `@Global()` module with `PaystackService` that wraps all Paystack REST API calls.

### Files to Create

```
src/shared/paystack/
  paystack.module.ts
  paystack.service.ts
```

### Implementation Notes

- **`@Global()` module** — registered once in `AppModule.imports`, available everywhere without explicit imports.
- **`paystackRequest()` helper** — all API calls go through this single method for consistent error handling, logging, and response parsing (design doc section 9).
- **`verifyWebhookSignature()`** — uses Node's `crypto.createHmac('sha512', secret)`. Takes a `Buffer` (raw body), not a string.
- **`encodeURIComponent(reference)`** in `verifyTransaction` path — defense against malformed references.
- **`URLSearchParams`** in `resolveAccount` — no string interpolation for query params.
- **Inject `Logger`** — use NestJS's built-in `Logger` scoped to `PaystackService` for structured logging of API errors.
- **No retry logic yet** — Paystack calls are not retried at this level. Retries happen at the BullMQ job level (Phase 12) where they belong.

### Checkpoint
Write a simple integration test (or manual test) that calls `paystackService.initializeTransaction()` with test credentials. Verify it returns `authorization_url`. (Use Paystack test keys.)

---

## Phase 4 — UsersModule

**Goal:** User CRUD operations, profile endpoints. This module is imported by almost everything else.

### Files to Create

```
src/modules/users/
  users.module.ts
  users.service.ts
  users.controller.ts
  dto/update-profile.dto.ts
```

### Service Methods

- `findById(id: string): Promise<User>`
- `findByGoogleId(googleId: string): Promise<User | null>`
- `findByEmail(email: string): Promise<User | null>`
- `findByReferralCode(code: string): Promise<User | null>`
- `create(data: Partial<User>): Promise<User>`
- `update(id: string, data: Partial<User>): Promise<User>`
- `getDashboardStats(userId: string)` — aggregate query joining wallets, visits, campaigns, referrals

### Controller Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | JWT | Return current user profile |
| PATCH | `/users/me` | JWT | Update phone, fullName |
| GET | `/users/me/dashboard` | JWT | Aggregated stats for the user |

### Implementation Notes

- **`UsersModule` exports `UsersService`** — it's consumed by AuthModule, ReferralsModule, AdminModule.
- **`TypeOrmModule.forFeature([User])`** in the module imports.
- **Dashboard query** should be a single optimized query (or parallel queries), not N+1. Use QueryBuilder or raw SQL for the aggregation:
  - Wallet balance, totalEarned, totalWithdrawn
  - Count of completed visits
  - Count of active campaigns (if advertiser)
  - Referral count + total referral earnings
- **`UpdateProfileDto`** — only allow `phone` and `fullName` to be updated. Never allow `role`, `isBlocked`, `isDeposited`, `referralCode` to be set via this endpoint.

### Checkpoint
With a manually inserted user in the DB, verify `GET /v1/users/me` returns 401 without a token (auth not wired yet, but the guard should reject). We'll fully test this after Phase 6.

---

## Phase 5 — WalletModule (Internal Operations Only)

**Goal:** Wallet creation, balance reads, and internal credit/debit methods used by other modules. Deposit/withdrawal endpoints come later.

### Files to Create

```
src/modules/wallet/
  wallet.module.ts
  wallet.service.ts          (partial — internal ops only)
  wallet.controller.ts       (shell — endpoints added in Phases 9-10)
  dto/list-transactions.dto.ts
  entities/                  (already created in Phase 2)
```

### Service Methods (This Phase)

- `createWallet(userId: string): Promise<Wallet>` — called by AuthService on new user signup
- `getWallet(userId: string): Promise<Wallet>`
- `getBalance(userId: string): Promise<number>`
- `creditReferralBonus(userId: string, amount: number, description: string)` — used by ReferralsService
- `getTransactions(userId: string, pagination: ListTransactionsDto): Promise<PaginatedResult<Transaction>>`

### Controller Endpoints (This Phase)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/wallet/balance` | JWT | Return wallet balance |
| GET | `/wallet/transactions` | JWT | Paginated transaction history |

### Implementation Notes

- **`WalletModule` exports `WalletService`** — consumed by VisitsModule, ReferralsModule, AdminModule, CampaignsModule.
- **`TypeOrmModule.forFeature([Wallet, Transaction, BankAccount, Withdrawal])`** — register all wallet-related entities even though we won't use them all yet.
- **`creditReferralBonus`** should wrap the wallet update + transaction creation in a DB transaction using `DataSource.transaction()`.
- **Pagination for `getTransactions`:** Use cursor-based pagination (keyset on `createdAt` + `id`) rather than offset. Offset pagination degrades at scale. The DTO should accept `cursor?: string` and `limit: number` (default 20, max 50).

### Checkpoint
Manually create a wallet for a user via `walletService.createWallet()` in a test. Verify `GET /v1/wallet/balance` returns 0 (once auth is wired in Phase 6).

---

## Phase 6 — AuthModule

**Goal:** Full Google OAuth sign-in flow, JWT issuance, refresh token rotation, logout. First end-to-end testable flow.

### Files to Create

```
src/modules/auth/
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  google-oauth.service.ts
  strategies/jwt.strategy.ts
  dto/google-signin.dto.ts
  dto/refresh-token.dto.ts
  entities/                  (already created in Phase 2)
```

### Service Methods

- `googleSignIn(dto: GoogleSignInDto): Promise<SignInResult>` — verify token, find/create user, create wallet, link referral, issue tokens
- `refreshTokens(rawRefreshToken: string): Promise<TokenPair>` — rotate refresh token
- `logout(userId: string, rawRefreshToken: string): Promise<void>`
- `revokeAllUserSessions(userId: string): Promise<void>` — called by AdminService on block
- `issueTokenPair(user: User): Promise<TokenPair>` — private, creates JWT + refresh token
- `hashToken(token: string): string` — private, bcrypt hash for refresh token storage
- `generateUniqueReferralCode(name: string): Promise<string>` — private, with collision retry

### Controller Endpoints

| Method | Path | Auth | Throttle | Description |
|---|---|---|---|---|
| POST | `/auth/google` | @Public | 10/5min | Google sign-in |
| POST | `/auth/refresh` | @Public | 10/5min | Refresh token rotation |
| POST | `/auth/logout` | JWT | - | Revoke current refresh token |

### Implementation Notes

- **`JwtStrategy.validate(payload)`** must load the full User entity from DB:
  ```typescript
  async validate(payload: { sub: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user; // This becomes request.user — used by all guards
  }
  ```
  This is critical. Without this, BlockGuard and DepositGuard would read stale JWT claims.

- **`GoogleOAuthService`** should use the `google-auth-library` package (`npm i google-auth-library`) to verify ID tokens. Specifically `OAuth2Client.verifyIdToken()` which checks `aud`, `iss`, expiry, and signature. Do NOT manually decode the JWT — always use Google's library.

- **RS256 JWT signing:** `@nestjs/jwt` module config needs `algorithm: 'RS256'` and the private key in PEM format. The public key is used by `JwtStrategy` for verification. For development, generate an RSA keypair:
  ```bash
  openssl genrsa -out jwt-private.pem 2048
  openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
  ```
  Store the private key in `JWT_SECRET` env var (entire PEM content). Read it in configuration.ts.

- **Refresh token storage:** Hash with bcrypt (cost factor 10) before storing. On refresh, bcrypt.compare() the raw token against the stored hash. This means refresh token lookups cannot use a simple `WHERE tokenHash = ?` — you must query by `userId` and then compare hashes in application code, OR use SHA-256 for the lookup hash and bcrypt for the stored hash (two-hash approach). The design doc uses a single hash approach with `findOne({ where: { tokenHash: hash } })`, which implies SHA-256 (not bcrypt) for lookability. **Decision: Use SHA-256** for the `tokenHash` column since we need to look up by hash value. bcrypt hashes are non-deterministic and can't be used for WHERE clauses.

- **Circular dependency: AuthModule <-> AdminModule.** AdminService calls `authService.revokeAllUserSessions()`, and AuthModule imports ReferralsModule. Use `forwardRef(() => AuthModule)` in AdminModule and vice versa where needed. Alternatively, extract `revokeAllUserSessions` into a standalone `SessionService` to break the cycle.

- **`AuthModule.imports`:** `PassportModule.register({ defaultStrategy: 'jwt' })`, `JwtModule.registerAsync(...)`, `UsersModule`, `forwardRef(() => ReferralsModule)`, `forwardRef(() => WalletModule)`, `TypeOrmModule.forFeature([RefreshToken])`.

- **New user signup atomicity:** The `googleSignIn` flow creates a user, wallet, and optional referral record. If the wallet creation fails after user creation, you have an orphaned user with no wallet. Wrap the entire find-or-create block in a DB transaction.

### Checkpoint
Full end-to-end test:
1. Call `POST /v1/auth/google` with a valid Google ID token (use a real test Google account or mock `GoogleOAuthService` in dev).
2. Verify response contains `accessToken`, `refreshToken`, `isNewUser: true`, and `user` object with a `referralCode`.
3. Use the `accessToken` to call `GET /v1/users/me` — verify it returns the user.
4. Call `POST /v1/auth/refresh` — verify new token pair is returned and old refresh token is revoked.
5. Call `POST /v1/auth/logout` — verify the refresh token is revoked.
6. Verify a second `POST /v1/auth/google` with the same Google account returns `isNewUser: false`.

---

## Phase 7 — CampaignsModule

**Goal:** Campaign creation with budget escrow, listing, detail, and advertiser's own campaigns.

### Files to Create

```
src/modules/campaigns/
  campaigns.module.ts
  campaigns.controller.ts
  campaigns.service.ts
  dto/create-campaign.dto.ts
  dto/list-campaigns.dto.ts
  dto/update-campaign-status.dto.ts
  entities/                  (already created in Phase 2)
```

### Service Methods

- `createCampaign(userId: string, dto: CreateCampaignDto): Promise<Campaign>` — validate budget, escrow from wallet, create campaign
- `findActiveById(id: string): Promise<Campaign | null>`
- `findById(id: string): Promise<Campaign>`
- `listCampaigns(dto: ListCampaignsDto): Promise<PaginatedResult<Campaign>>` — public listing of ACTIVE campaigns
- `listMyCampaigns(userId: string, dto: ListCampaignsDto): Promise<PaginatedResult<Campaign>>`
- `updateStatus(campaignId: string, userId: string, dto: UpdateCampaignStatusDto)` — advertiser can pause/resume their own campaign
- `getPayPerVisit(tier: PricingTier): number` — lookup pricing table

### Controller Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/campaigns` | JWT | List active campaigns (paginated) |
| GET | `/campaigns/mine` | JWT | List current user's campaigns |
| POST | `/campaigns` | JWT, Throttle 10/hr | Create campaign (escrow budget) |
| GET | `/campaigns/:id` | JWT | Campaign detail |
| PATCH | `/campaigns/:id/status` | JWT | Pause/resume own campaign |

### Implementation Notes

- **Route ordering:** In the controller, define `@Get('mine')` BEFORE `@Get(':id')`. NestJS matches routes in definition order. If `:id` is first, `mine` gets matched as an ID parameter.

- **`CampaignsModule.imports`:** `TypeOrmModule.forFeature([Campaign])`, `WalletModule` (for escrow debit).

- **Pricing tier lookup:** Define a constant map, not a DB table:
  ```typescript
  const PRICING_TABLE: Record<PricingTier, { payPerVisit: number }> = {
    [PricingTier.ECONOMY]:  { payPerVisit: 5000 },    // 50 NGN
    [PricingTier.STANDARD]: { payPerVisit: 10000 },   // 100 NGN
    [PricingTier.PREMIUM]:  { payPerVisit: 20000 },   // 200 NGN
  };
  ```
  (Adjust actual values to business requirements — these are placeholders.)

- **Budget validation in service, not DTO:** `budget >= totalVisits * getPayPerVisit(pricingTier)` must be checked in the service because `payPerVisit` is derived from the tier. The DTO can only validate `budget >= 1,500,000`.

- **Escrow transaction:** The entire `createCampaign` must be one DB transaction: debit wallet -> create Transaction record -> create Campaign. If any step fails, everything rolls back.

- **Campaign listing pagination:** Use cursor-based pagination with `(createdAt, id)` keyset. The `ListCampaignsDto` should accept `cursor`, `limit`, and optional filters like `campaignType` and `pricingTier`.

### Checkpoint
1. Fund a test user's wallet manually (direct DB insert or via deposit in Phase 9).
2. `POST /v1/campaigns` with valid data — verify campaign created with `PENDING_REVIEW` status, wallet debited, escrow Transaction record created.
3. `POST /v1/campaigns` with insufficient balance — verify `INSUFFICIENT_BALANCE` error.
4. `GET /v1/campaigns/mine` — verify the campaign appears.
5. `GET /v1/campaigns` — verify the campaign does NOT appear (it's PENDING_REVIEW, not ACTIVE).

---

## Phase 8 — VisitsModule

**Goal:** The core earning flow — start visit, complete visit with server-side timing, fraud prevention, pessimistic locks, and atomic wallet credit.

### Files to Create

```
src/modules/visits/
  visits.module.ts
  visits.controller.ts
  visits.service.ts
  dto/start-visit.dto.ts
  dto/complete-visit.dto.ts
  entities/                  (already created in Phase 2)
```

### Service Methods

- `startVisit(userId: string, dto: StartVisitDto): Promise<StartVisitResult>`
- `completeVisit(userId: string, visitId: string, clientDuration: number): Promise<CompleteVisitResult>`
- `getVisitHistory(userId: string, pagination): Promise<PaginatedResult<Visit>>`

### Controller Endpoints

| Method | Path | Auth | Decorators | Description |
|---|---|---|---|---|
| POST | `/visits/start` | JWT | @RequiresDeposit, Throttle 1/30s | Start a visit |
| POST | `/visits/:id/complete` | JWT | @RequiresDeposit | Complete a visit |
| GET | `/visits/history` | JWT | | Visit history (paginated) |

### Implementation Notes

This is the most complex and security-critical module. Every detail matters.

- **`VisitsModule.imports`:** `TypeOrmModule.forFeature([Visit, Campaign, Wallet, Transaction])`, `WalletModule`, `CampaignsModule`. Also `BullModule.registerQueue({ name: 'referral-milestones' })` for milestone 2 dispatch.

- **`startVisit` checks (in order):**
  1. Campaign exists and is ACTIVE
  2. Campaign has remaining slots (`completedVisits < totalVisits`)
  3. Not a self-visit (`campaign.advertiserId !== userId`)
  4. Auto-abandon stale visits (>10 min) for this user
  5. No active in-progress visit for this user
  6. User hasn't already completed this campaign

- **`completeVisit` transaction (in order):**
  1. Load visit with campaign relation
  2. Ownership check (`visit.userId === userId`)
  3. Idempotency check (already completed -> return cached result)
  4. Server-side elapsed time check (NEVER trust clientDuration)
  5. Begin DB transaction:
     a. Pessimistic lock on visit row (`SELECT ... FOR UPDATE`)
     b. Double-check visit status (race condition guard)
     c. Claim campaign slot (`UPDATE campaigns SET ... WHERE completedVisits < totalVisits`)
     d. Check `affected === 0` -> mark visit ABANDONED, return slotsExhausted
     e. Mark visit COMPLETED
     f. Credit earner wallet (parameterized query)
     g. Create EARNING transaction record
     h. Auto-complete campaign if slots full
     i. Read final wallet balance
  6. After transaction: dispatch milestone-2 check to BullMQ queue

- **Queue injection:** Inject the referral-milestones queue with `@InjectQueue('referral-milestones')` to dispatch the milestone 2 check job after visit completion. The actual processor is built in Phase 12.

- **`@RequiresDeposit()` decorator:** Both `startVisit` and `completeVisit` require the user to have made at least one deposit. Apply at controller method level.

- **Parameterized queries EVERYWHERE:** Never use `\`balance + ${earned}\`` — always use `.setParameter('earned', earned)`.

### Checkpoint
This requires a campaign in ACTIVE status. For testing, either:
- Directly update a campaign's status to ACTIVE in the DB, OR
- Build Phase 15 (Admin) first — but that's out of order. Direct DB update is simpler for now.

Test flow:
1. `POST /v1/visits/start` with an active campaign -> receive `visitId`, `minDuration`
2. Wait less than `minDuration` seconds, call `POST /v1/visits/:id/complete` -> 403 "duration not met"
3. Wait the full `minDuration`, call complete again -> success, `earned` amount returned, wallet balance increased
4. Try to start another visit for the same campaign -> 409 "Already completed"
5. Try to start a visit for own campaign -> 403 "Cannot visit your own campaign"
6. Concurrent test: start two visits for the same user simultaneously -> one should 409

---

## Phase 9 — WalletModule: Deposits

**Goal:** Paystack-powered deposit flow — initialize, redirect, verify.

### Files to Add/Modify

```
src/modules/wallet/
  dto/initialize-deposit.dto.ts
  dto/verify-deposit.dto.ts
  wallet.service.ts           (add initializeDeposit, verifyDeposit, creditWalletFromDeposit)
  wallet.controller.ts        (add deposit endpoints)
```

### New Controller Endpoints

| Method | Path | Auth | Throttle | Description |
|---|---|---|---|---|
| POST | `/wallet/deposit/initialize` | JWT | 5/15min | Start Paystack deposit |
| GET | `/wallet/deposit/verify/:reference` | JWT | | Verify deposit status |

### Implementation Notes

- **`initializeDeposit`:** Creates a PENDING Transaction record with a unique `TXN_{nanoid(12)}` reference, then calls Paystack to get the `authorization_url`. Returns the URL to the client for redirect.

- **`verifyDeposit`:** Client calls this after Paystack redirect. Checks if already successful (idempotent), otherwise calls `paystackService.verifyTransaction()` and credits the wallet if Paystack says success.

- **`creditWalletFromDeposit`:** In a DB transaction: credit wallet balance, mark Transaction as SUCCESSFUL, set `user.isDeposited = true` (only on first deposit). After the transaction, dispatch `check-milestone-1` job to the referral-milestones queue.

- **`isDeposited` flag:** Updated inside the same DB transaction as the wallet credit. Uses `WHERE "isDeposited" = false` so it's a no-op on subsequent deposits. This flag unlocks visit endpoints via DepositGuard.

- **Minimum deposit:** 1,500,000 kobo (15,000 NGN) enforced by DTO validation.

### Checkpoint
1. `POST /v1/wallet/deposit/initialize` with `{ amount: 1500000, paymentMethod: "card" }` — get Paystack authorization URL.
2. Complete payment in Paystack test mode.
3. `GET /v1/wallet/deposit/verify/:reference` — verify wallet balance increased, Transaction status is SUCCESSFUL, `isDeposited` is true.
4. User can now access `@RequiresDeposit()` endpoints.

---

## Phase 10 — WalletModule: Bank Accounts + Withdrawals

**Goal:** Add bank account management and withdrawal flow.

### Files to Add/Modify

```
src/modules/wallet/
  dto/add-bank-account.dto.ts
  dto/withdraw.dto.ts
  wallet.service.ts           (add bank account + withdrawal methods)
  wallet.controller.ts        (add remaining endpoints)
```

### New Controller Endpoints

| Method | Path | Auth | Throttle | Description |
|---|---|---|---|---|
| POST | `/wallet/bank-accounts` | JWT | | Add bank account (Paystack verify) |
| GET | `/wallet/bank-accounts` | JWT | | List user's bank accounts |
| DELETE | `/wallet/bank-accounts/:id` | JWT | | Remove a bank account |
| POST | `/wallet/withdraw` | JWT | 3/hr | Request withdrawal |
| GET | `/wallet/withdrawals` | JWT | | List withdrawal history |

### Implementation Notes

- **`addBankAccount`:** Call `paystackService.resolveAccount()` to verify the account number + bank code. Only save if Paystack confirms the account is valid. Store the Paystack-verified `accountName`.

- **`requestWithdrawal` flow:**
  1. Pre-check: wallet.balance >= dto.amount
  2. DB transaction:
     a. Atomic debit: `UPDATE wallets SET balance = balance - :amount WHERE userId = :userId AND balance >= :amount`
     b. Check `affected === 0` -> throw INSUFFICIENT_BALANCE (concurrent drain)
     c. Create PENDING Transaction record
     d. Create PROCESSING Withdrawal record
  3. After transaction: if amount <= 10,000,000 kobo, dispatch `process-transfer` job to withdrawal-processing queue. Otherwise, it sits in PROCESSING for admin manual review.

- **Minimum withdrawal:** 500,000 kobo (5,000 NGN) enforced by DTO validation.

- **Bank account limit:** Consider adding a max bank accounts per user check (e.g., 5) to prevent abuse. Not in the design doc but a reasonable safeguard.

### Checkpoint
1. Add a bank account with valid Nigerian bank details (test mode).
2. Request a withdrawal for less than 100,000 NGN — verify wallet debited, withdrawal record in PROCESSING.
3. Request a withdrawal with insufficient balance — verify 400 error.
4. Request a withdrawal concurrently from two sessions — verify only one succeeds.

---

## Phase 11 — ReferralsModule

**Goal:** Referral tracking, milestone bonus crediting, and referral dashboard.

### Files to Create

```
src/modules/referrals/
  referrals.module.ts
  referrals.controller.ts
  referrals.service.ts
  entities/                  (already created in Phase 2)
```

### Service Methods

- `createReferralRecord(referrerId: string, refereeId: string): Promise<Referral>` — called by AuthService on signup
- `checkAndCreditMilestone1(refereeId: string): Promise<void>` — first deposit bonus
- `checkAndCreditMilestone2(refereeId: string): Promise<void>` — 10 completed visits bonus
- `getReferralStats(userId: string)` — count, milestone statuses, total earned
- `getReferrals(userId: string, pagination)` — list referees with masked names
- `maskName(fullName: string): string` — "Chioma Eze" -> "Chi***"

### Controller Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/referrals` | JWT | Referral dashboard (stats + paginated list of referees) |

### Implementation Notes

- **`ReferralsModule.imports`:** `TypeOrmModule.forFeature([Referral, Visit])`, `WalletModule`. Note: imports Visit entity directly (for milestone 2 count query) — does NOT import VisitsModule.

- **`ReferralsModule.exports`:** `ReferralsService` (used by AuthModule).

- **Milestone idempotency:** Both milestone methods check the `milestoneXCredited` flag before crediting. This prevents double-crediting if the BullMQ job is retried. The flag update and wallet credit should ideally be in the same transaction for atomicity.

- **Milestone 1 (375,000 kobo = 3,750 NGN):** Triggered when referee makes first deposit. Credited to the referrer's wallet.

- **Milestone 2 (375,000 kobo = 3,750 NGN):** Triggered when referee completes 10 visits. Credited to the referrer's wallet.

- **Name masking:** `maskName("Chioma Eze")` returns `"Chi***"`. Handle edge cases: names shorter than 3 characters (show the full first name + `***`).

- **Referral stats query:** Join referrals with users (for referee info) and aggregate milestone data. Mask all referee names in the response.

### Checkpoint
1. Create a new user with a valid referral code -> verify Referral record created.
2. Deposit as the referee -> verify milestone 1 credited to referrer's wallet (375,000 kobo).
3. Complete 10 visits as the referee -> verify milestone 2 credited (375,000 kobo).
4. `GET /v1/referrals` -> verify stats show correct counts and masked names.

---

## Phase 12 — BullMQ Processors

**Goal:** Background job processors for all 4 queues.

### Files to Create

```
src/modules/wallet/processors/
  withdrawal.processor.ts
  webhook-event.processor.ts

src/modules/referrals/processors/
  referral-milestone.processor.ts

src/modules/campaigns/processors/
  campaign-maintenance.processor.ts
```

### Queue: `withdrawal-processing`

| Job | Handler |
|---|---|
| `process-transfer` | Create Paystack transfer recipient -> initiate transfer -> update Withdrawal with transfer code |

- **Error handling:** If Paystack call fails, the BullMQ job will retry (configure `attempts: 3, backoff: { type: 'exponential', delay: 5000 }`). If all retries fail, mark the withdrawal as FAILED and refund the wallet.

### Queue: `referral-milestones`

| Job | Handler |
|---|---|
| `check-milestone-1` | Call `referralsService.checkAndCreditMilestone1(userId)` |
| `check-milestone-2` | Call `referralsService.checkAndCreditMilestone2(userId)` |

- These are idempotent so retries are safe.

### Queue: `webhook-events`

| Job | Handler |
|---|---|
| `paystack-charge.success` | Call `walletService.handleChargeSuccess(data)` |
| `paystack-transfer.success` | Call `walletService.handleTransferSuccess(data)` |
| `paystack-transfer.failed` | Call `walletService.handleTransferFailed(data)` |
| `paystack-transfer.reversed` | Call `walletService.handleTransferFailed(data)` |

### Queue: `campaign-maintenance`

| Job | Handler |
|---|---|
| `expire-stale-visits` | `UPDATE visits SET status = 'abandoned' WHERE status = 'in_progress' AND "serverStartTime" < NOW() - INTERVAL '20 minutes'` |

- **Scheduled via `@Cron('*/30 * * * *')`** — runs every 30 minutes. Use `@nestjs/schedule` package (`npm i @nestjs/schedule`). Register `ScheduleModule.forRoot()` in AppModule.
- The 20-minute threshold is 2x the maximum possible visit duration (300 seconds = 5 min, so 2x = 10 min, with buffer = 20 min). This is intentionally longer than the 10-min inline stale check in `startVisit` to catch any stragglers.

### Implementation Notes

- **Register queues in AppModule:**
  ```typescript
  BullModule.registerQueue(
    { name: 'withdrawal-processing' },
    { name: 'referral-milestones' },
    { name: 'webhook-events' },
    { name: 'campaign-maintenance' },
  )
  ```

- **Processor registration:** Each processor class is registered in its owning module (e.g., `WithdrawalProcessor` in `WalletModule`, `CampaignMaintenanceProcessor` in `CampaignsModule`).

- **Job configuration defaults:** Configure all queues with `defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 }` to prevent Redis from accumulating completed/failed jobs indefinitely.

### Checkpoint
1. Trigger a deposit -> verify `check-milestone-1` job appears in Redis and executes.
2. Request a withdrawal (< 100k NGN) -> verify `process-transfer` job executes and calls Paystack.
3. Wait 30 minutes (or manually trigger) -> verify stale visits are abandoned.

---

## Phase 13 — WebhooksModule

**Goal:** Receive and validate Paystack webhook events, queue them for async processing.

### Files to Create

```
src/modules/webhooks/
  webhooks.module.ts
  paystack-webhook.controller.ts
```

### Controller Endpoint

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/paystack` | @Public (HMAC verified) | Receive Paystack events |

### Implementation Notes

- **Raw body access:** The controller receives `@Req() req: RawBodyRequest<Request>`. The `rawBody` Buffer is available because `main.ts` creates the app with `{ rawBody: true }` and registers `express.raw()` on this route.

- **HMAC verification:** Call `paystackService.verifyWebhookSignature(req.rawBody, signature)`. If invalid, throw 403. This happens BEFORE any JSON parsing.

- **Async processing:** Parse the raw body, extract `event` and `data`, then `await webhookQueue.add(\`paystack-${event}\`, { event, data })`. Return `{ received: true }` immediately. The actual processing happens in the webhook-event processor (Phase 12).

- **No throttling on this endpoint:** Paystack may send bursts of webhooks. The global throttler still applies (100/min per IP) which should be sufficient, but consider excluding this endpoint from throttling if Paystack sends many events.

- **`WebhooksModule.imports`:** `BullModule.registerQueue({ name: 'webhook-events' })`, `PaystackModule` (already global).

### Checkpoint
Use Paystack's webhook test tool (or curl) to send a test `charge.success` event. Verify:
1. Invalid signature -> 403
2. Valid signature -> 200 `{ received: true }`
3. Job appears in `webhook-events` queue in Redis
4. Webhook processor credits the wallet

---

## Phase 14 — PlatformModule

**Goal:** Public endpoints for platform stats and config, with Redis caching.

### Files to Create

```
src/modules/platform/
  platform.module.ts
  platform.controller.ts
  platform.service.ts
```

### Controller Endpoints

| Method | Path | Auth | Cache | Description |
|---|---|---|---|---|
| GET | `/platform/stats` | @Public | 5 min | Total users, visits, campaigns, payouts |
| GET | `/platform/config` | @Public | 1 hour | Pricing tiers, min amounts, etc. |

### Implementation Notes

- **Caching:** Use `@UseInterceptors(CacheInterceptor)` with `@CacheKey('platform:stats')` and `@CacheTTL(300)`.
- **Stats query:** Aggregate query across users (count), visits (count completed), campaigns (count active), wallets (sum of totalEarned across all users). This should be a single raw SQL query for performance.
- **Config endpoint:** Returns static business rules (min deposit, min withdrawal, pricing tiers) that the frontend needs. No DB query required — just return a constant object. Cache for 1 hour to allow future DB-backed config changes.

### Checkpoint
1. `GET /v1/platform/stats` without auth -> returns stats.
2. Call again within 5 min -> response is instant (cached).
3. `GET /v1/platform/config` -> returns pricing tiers and limits.

---

## Phase 15 — AdminModule

**Goal:** Admin-only endpoints for campaign review, user management, withdrawal processing, and analytics.

### Files to Create

```
src/modules/admin/
  admin.module.ts
  admin.controller.ts
  admin.service.ts
  dto/review-campaign.dto.ts
  dto/block-user.dto.ts
  dto/process-withdrawal.dto.ts
```

### Controller Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/users` | @Roles('admin') | List all users (paginated, searchable) |
| PATCH | `/admin/users/:id/block` | @Roles('admin') | Block/unblock user |
| GET | `/admin/campaigns` | @Roles('admin') | List campaigns by status |
| PATCH | `/admin/campaigns/:id/review` | @Roles('admin') | Approve/reject campaign |
| GET | `/admin/withdrawals` | @Roles('admin') | List pending withdrawals |
| PATCH | `/admin/withdrawals/:id/process` | @Roles('admin') | Manually process/reject withdrawal |
| GET | `/admin/analytics` | @Roles('admin') | Platform-wide analytics |

### Implementation Notes

- **All endpoints gated by `@Roles('admin')`** at the controller class level.

- **`AdminModule.imports`:** `TypeOrmModule.forFeature([User, Campaign, Withdrawal, Wallet, Transaction])`, `forwardRef(() => AuthModule)` (for session revocation).

- **`blockUser`:** Update user's `isBlocked`, `blockedReason`, `blockedAt`. If blocking, call `authService.revokeAllUserSessions(userId)` to immediately invalidate all refresh tokens. Log the admin action.

- **`reviewCampaign`:**
  - Check campaign is in `PENDING_REVIEW` status.
  - If approving: set status to `ACTIVE`.
  - If rejecting: set status to `REJECTED` AND refund the escrowed budget to the advertiser's wallet in the same DB transaction. Create a refund Transaction record.

- **`processWithdrawal` (manual):** For withdrawals > 100k NGN that need admin approval. Admin can either approve (triggers Paystack transfer) or reject (refunds wallet). Must be in a DB transaction.

- **Admin user creation:** There's no admin signup flow in the design. The first admin user should be created via a database seed script or migration:
  ```sql
  UPDATE users SET role = 'admin' WHERE email = 'admin@trafficpay.ng';
  ```

- **Circular dependency with AuthModule:** AdminService needs AuthService.revokeAllUserSessions(). Use `@Inject(forwardRef(() => AuthService))`.

### Checkpoint
1. Create an admin user (direct DB update).
2. Login as admin -> `GET /v1/admin/campaigns` shows pending campaigns.
3. Approve a campaign -> status changes to ACTIVE, can now be visited.
4. Reject a campaign -> status changes to REJECTED, advertiser wallet refunded.
5. Block a user -> all their refresh tokens revoked, subsequent API calls return 403.
6. Login as a non-admin -> all `/admin/*` endpoints return 403.

---

## Phase 16 — Testing + Hardening

**Goal:** Comprehensive test coverage for critical flows and edge cases.

### Unit Tests (service-level)

| Test File | Key Scenarios |
|---|---|
| `auth.service.spec.ts` | New user creation, referral linking, blocked user rejection, token rotation, referral code collision retry |
| `visits.service.spec.ts` | Server-time validation, self-visit block, duplicate visit block, stale visit auto-abandon, pessimistic lock, slot exhaustion, idempotent complete |
| `wallet.service.spec.ts` | Deposit credit idempotency, withdrawal concurrent drain, amount mismatch rejection, transfer failure refund |
| `campaigns.service.spec.ts` | Budget validation, escrow debit, insufficient balance, pricing tier lookup |
| `referrals.service.spec.ts` | Milestone 1 credit, milestone 2 threshold, double-credit prevention, name masking edge cases |
| `admin.service.spec.ts` | Block with session revocation, campaign rejection with refund |

### E2E Tests

| Test File | Key Flows |
|---|---|
| `auth.e2e-spec.ts` | Full Google sign-in -> refresh -> logout cycle |
| `visit-lifecycle.e2e-spec.ts` | Deposit -> create campaign (admin approve) -> start visit -> wait -> complete -> check wallet |
| `withdrawal.e2e-spec.ts` | Deposit -> earn -> withdraw -> verify webhook completes it |
| `referral.e2e-spec.ts` | Sign up with referral -> deposit (M1) -> complete 10 visits (M2) -> check referrer earnings |

### Concurrency Tests

These are critical and must be tested under load:

| Scenario | Tool | Expected |
|---|---|---|
| Double-complete same visit | Parallel HTTP requests | Only one credit, second returns idempotent result |
| Two withdrawals draining balance | Parallel HTTP requests | Only one succeeds, other gets INSUFFICIENT_BALANCE |
| Many users completing last campaign slot | k6 or autocannon | Exactly `totalVisits` get credited, no over-completion |
| Webhook + verifyDeposit race | Parallel calls | Wallet credited exactly once |

### Hardening Checklist

- [ ] All bigint columns have the transformer (no string comparisons)
- [ ] All `.set()` expressions use `.setParameter()`, never string interpolation
- [ ] All wallet mutations are inside DB transactions
- [ ] All `affected === 0` checks are in place for atomic updates
- [ ] All list endpoints have pagination (no unbounded queries)
- [ ] Rate limits are applied to all sensitive endpoints
- [ ] Swagger decorators are added to all controllers and DTOs
- [ ] Error responses never leak stack traces or internal details in production
- [ ] `helmet()` is active in production
- [ ] CORS whitelist is correctly configured
- [ ] `.env` is in `.gitignore`
- [ ] Partial unique index on visits exists and is tested
- [ ] Admin-only endpoints are gated by @Roles('admin')
- [ ] Webhook HMAC verification is tested with invalid signatures

---

## Summary: File Count by Phase

| Phase | New Files | Description |
|---|---|---|
| 0 | 4 | Scaffold, config, main, app.module |
| 1 | 17 | Enums, guards, decorators, filter, interceptor, pipe |
| 2 | 10 | 9 entities + 1 migration |
| 3 | 2 | PaystackModule + PaystackService |
| 4 | 4 | UsersModule |
| 5 | 4 | WalletModule (partial) |
| 6 | 7 | AuthModule |
| 7 | 6 | CampaignsModule |
| 8 | 5 | VisitsModule |
| 9 | 2 | Deposit DTOs + service additions |
| 10 | 2 | Bank account + withdrawal DTOs |
| 11 | 3 | ReferralsModule |
| 12 | 4 | BullMQ processors |
| 13 | 2 | WebhooksModule |
| 14 | 3 | PlatformModule |
| 15 | 6 | AdminModule |
| 16 | ~12 | Test files |
| **Total** | **~91** | |
