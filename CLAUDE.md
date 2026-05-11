# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TrafficPay is a paid traffic platform where advertisers create campaigns and users earn money by visiting them. Built with NestJS, TypeScript, PostgreSQL, Redis, BullMQ, and Paystack for payments. The system design spec is in `TrafficPay_NestJS_System_Design.md`.

## Commands

```bash
# Install dependencies
npm install

# Run development server
npm run start:dev

# Run production build
npm run build && npm run start:prod

# Run all tests
npm run test

# Run a single test file
npm run test -- --testPathPattern=<pattern>

# Run e2e tests
npm run test:e2e

# Generate a migration
npm run migration:generate -- src/database/migrations/<MigrationName>

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Lint
npm run lint
```

Swagger docs available at `/docs` in non-production environments.

## Architecture

### Module Structure

All feature modules live under `src/modules/`. Each module follows the pattern: `module.ts`, `controller.ts`, `service.ts`, `dto/`, `entities/`.

**10 modules:** Auth, Users, Campaigns, Visits, Wallet, Referrals, Platform, Admin, Webhooks, Queues
**Shared:** `src/modules/shared/paystack/` — global PaystackService wrapping all Paystack REST calls.
**Common:** `src/common/` — guards, decorators (`@Public`, `@Roles`, `@CurrentUser`, `@RequiresDeposit`), enums (barrel-exported from `enums/index.ts`), filters, interceptors, and `bigintTransformer` (used on all kobo columns).

### Request Pipeline (order matters)

ThrottlerGuard → JwtAuthGuard → BlockGuard → RolesGuard → DepositGuard → ValidationPipe → Handler

- `@Public()` skips JWT auth
- `@Roles('admin')` triggers RolesGuard
- `@RequiresDeposit()` triggers DepositGuard (visits endpoints)
- `@CurrentUser()` extracts user from request

### API Response Shape

All responses wrapped by `ResponseInterceptor`: `{ success: true, data: ... }` for success, `{ success: false, error: { code, message, statusCode } }` for errors. Global prefix is `/v1`.

### Database Conventions

- **ORM:** TypeORM with PostgreSQL. All PKs are UUIDs.
- **Money:** All monetary amounts stored as `bigint` in **kobo** (1 NGN = 100 kobo). Never use decimal/float for money. Frontend handles display formatting.
- **Entities (9):** User, RefreshToken, Campaign, Visit, Wallet, Transaction, BankAccount, Withdrawal, Referral

### Key Business Rules

- **Visit fraud prevention:** Server-side timing only (never trust `clientDuration`). One in-progress visit per user (stale visits >10min auto-abandoned inline). One completed visit per user per campaign (enforced by partial unique index `WHERE status = 'completed'`). Self-visits blocked. `completeVisit` uses pessimistic row-level locks in a DB transaction to prevent double-credit. Campaign slot guard: `WHERE "completedVisits" < "totalVisits"` with `affected` check.
- **Wallet mutations** always happen inside a DB transaction. Withdrawals use `WHERE balance >= :amount` and **must check `result.affected === 1`** — if 0, abort (concurrent drain). Never use string interpolation in `.set()` — always use `.setParameter()`.
- **Campaign budget escrow:** Campaign creation debits the advertiser's wallet atomically. Rejected campaigns get a full refund. `budget >= totalVisits * payPerVisit` is validated in the service layer.
- **Paystack webhooks** must verify HMAC SHA-512 using raw body (not parsed JSON). All payment flows are idempotent.
- **Withdrawals over 10,000,000 kobo (NGN 100,000)** skip auto-transfer and require admin review.
- **Referral milestones** run async via BullMQ — never block visit completion. Each milestone credited exactly once. Referee names always masked in responses (`Chi***`).
- **JwtStrategy.validate()** must load the full User entity from DB on every request — guards depend on fresh `isBlocked`/`isDeposited`/`role`, not stale JWT claims.
- **All list endpoints** must implement pagination (cursor or offset).

### BullMQ Queues (4)

- `withdrawal-processing` — Paystack transfer after withdrawal creation
- `referral-milestones` — milestone 1 (first deposit) and milestone 2 (10 completed visits)
- `webhook-events` — async processing of Paystack webhook payloads
- `campaign-maintenance` — cron job to expire stale in-progress visits

### Auth Flow

Google OAuth only (verify `idToken` server-side). JWT access tokens (RS256, 15m expiry) + refresh token rotation (30d). Refresh tokens stored as bcrypt hashes. Blocking a user immediately revokes all their refresh tokens.

### Caching (Redis)

`platform:stats` (5min), `platform:config` (1hr), `campaign:list:{hash}` (30s), `user:blocked:{userId}` (60s).

### TypeScript / Imports

`tsconfig.json` uses `moduleResolution: "nodenext"` — use explicit `.js` extensions in relative imports if needed. `strictNullChecks` and `noImplicitAny` are enabled.

### Validation

Global `ValidationPipe` is configured with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, and `enableImplicitConversion: true`. DTOs should use `class-validator` decorators; unknown properties are automatically stripped and rejected.

### Configuration

`src/config/configuration.ts` — single config factory loaded globally via `ConfigModule`. `src/config/data-source.ts` — standalone TypeORM DataSource for CLI migrations (`entities` and `migrations` paths are glob-based there, but the app uses `autoLoadEntities: true`). Migrations live in `src/database/migrations/`.

### Environment Variables

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `GOOGLE_CLIENT_ID`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`

### Route Ordering Note

In CampaignsController, `/campaigns/mine` must be registered **before** `/campaigns/:id` to avoid NestJS matching "mine" as an `:id` param.

### Webhook Raw Body

`main.ts` disables NestJS's default body parser (`bodyParser: false`) and adds explicit `express.json()` with a `verify` callback that stores the raw buffer on `req.rawBody`. This ensures `req.rawBody` is always available for Paystack webhook HMAC-SHA512 verification.
