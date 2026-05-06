# TrafficPay — NestJS System Design

> **Version:** 1.3.0
> **Based on:** API Endpoints & Security Specification v1.1.0
> **Stack:** NestJS · TypeScript · PostgreSQL · Redis · BullMQ · Paystack

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Module Architecture](#2-module-architecture)
3. [Database Schema (Entities)](#3-database-schema-entities)
4. [Guards & Middleware Pipeline](#4-guards--middleware-pipeline)
5. [DTOs & Validation](#5-dtos--validation)
6. [Key Service Logic](#6-key-service-logic)
7. [Queue Design (BullMQ)](#7-queue-design-bullmq)
8. [Caching Strategy (Redis)](#8-caching-strategy-redis)
9. [Paystack Integration](#9-paystack-integration)
10. [Global Exception Filter & Response Interceptor](#10-global-exception-filter--response-interceptor)
11. [Rate Limiting Configuration](#11-rate-limiting-configuration)
12. [Environment Variables](#12-environment-variables)
13. [Bootstrap (main.ts)](#13-bootstrap-maints)
14. [Infrastructure Overview](#14-infrastructure-overview)
15. [Key Implementation Rules](#15-key-implementation-rules)

---

## 1. Project Structure

```
src/
├── main.ts
├── app.module.ts
│
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── google-oauth.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   ├── dto/
│   │   │   ├── google-signin.dto.ts
│   │   │   └── refresh-token.dto.ts
│   │   └── entities/
│   │       └── refresh-token.entity.ts
│   │
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── dto/
│   │   │   └── update-profile.dto.ts
│   │   └── entities/
│   │       └── user.entity.ts
│   │
│   ├── campaigns/
│   │   ├── campaigns.module.ts
│   │   ├── campaigns.controller.ts
│   │   ├── campaigns.service.ts
│   │   ├── dto/
│   │   │   ├── create-campaign.dto.ts
│   │   │   ├── list-campaigns.dto.ts
│   │   │   └── update-campaign-status.dto.ts
│   │   └── entities/
│   │       └── campaign.entity.ts
│   │
│   ├── visits/
│   │   ├── visits.module.ts
│   │   ├── visits.controller.ts
│   │   ├── visits.service.ts
│   │   ├── dto/
│   │   │   ├── start-visit.dto.ts
│   │   │   └── complete-visit.dto.ts
│   │   └── entities/
│   │       └── visit.entity.ts
│   │
│   ├── wallet/
│   │   ├── wallet.module.ts
│   │   ├── wallet.controller.ts
│   │   ├── wallet.service.ts
│   │   ├── dto/
│   │   │   ├── initialize-deposit.dto.ts
│   │   │   ├── verify-deposit.dto.ts
│   │   │   ├── withdraw.dto.ts
│   │   │   ├── add-bank-account.dto.ts
│   │   │   └── list-transactions.dto.ts
│   │   └── entities/
│   │       ├── wallet.entity.ts
│   │       ├── transaction.entity.ts
│   │       ├── bank-account.entity.ts
│   │       └── withdrawal.entity.ts
│   │
│   ├── referrals/
│   │   ├── referrals.module.ts
│   │   ├── referrals.controller.ts
│   │   ├── referrals.service.ts
│   │   └── entities/
│   │       └── referral.entity.ts
│   │
│   ├── platform/
│   │   ├── platform.module.ts
│   │   └── platform.controller.ts
│   │
│   ├── admin/
│   │   ├── admin.module.ts
│   │   ├── admin.controller.ts
│   │   ├── admin.service.ts
│   │   └── dto/
│   │       ├── review-campaign.dto.ts
│   │       ├── block-user.dto.ts
│   │       └── process-withdrawal.dto.ts
│   │
│   └── webhooks/
│       ├── webhooks.module.ts
│       └── paystack-webhook.controller.ts
│
├── common/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── block.guard.ts
│   │   ├── roles.guard.ts
│   │   └── deposit.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── public.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── response.interceptor.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── enums/
│       ├── role.enum.ts
│       ├── campaign-status.enum.ts
│       ├── visit-status.enum.ts
│       └── transaction-type.enum.ts
│
├── config/
│   └── configuration.ts
│
├── database/
│   └── migrations/
│
└── shared/
    └── paystack/
        ├── paystack.module.ts
        └── paystack.service.ts
```

---

## 2. Module Architecture

### 2.1 AppModule

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({ useFactory: (config) => config.get('database'), inject: [ConfigService] }),
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60000, limit: 100 },      // 100 req / 1 min per IP
    ]),
    BullModule.forRootAsync({ useFactory: (config) => ({ connection: { url: config.get('redisUrl') } }), inject: [ConfigService] }),
    CacheModule.registerAsync({ isGlobal: true, useFactory: (config) => ({ store: redisStore, url: config.get('redisUrl') }), inject: [ConfigService] }),
    AuthModule, UsersModule, CampaignsModule, VisitsModule,
    WalletModule, ReferralsModule, PlatformModule, AdminModule, WebhooksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },        // applied globally
    { provide: APP_FILTER, useClass: HttpExceptionFilter },   // global error shape
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }, // wrap { success, data }
    { provide: APP_PIPE, useClass: ValidationPipe },          // class-validator
  ],
})
export class AppModule {}
```

---

### 2.2 AuthModule

**Responsibilities:** Google ID token verification, JWT issuance, refresh token rotation, logout.

| Component | Role |
|---|---|
| `AuthController` | `/auth/google`, `/auth/refresh`, `/auth/logout` |
| `AuthService` | Orchestrates sign-in / token flow |
| `GoogleOAuthService` | Verifies Google `idToken` using Google's public certificates |
| `JwtStrategy` | Passport strategy — validates Bearer JWT and loads fresh `User` from DB (so guards see current `isBlocked`/`isDeposited`/`role`) |
| `RefreshToken` entity | Stores hashed refresh tokens |

**Imports:** `PassportModule`, `JwtModule`, `UsersModule`, `ReferralsModule`

---

### 2.3 UsersModule

**Responsibilities:** User profile retrieval and update, dashboard stats aggregation.

| Component | Role |
|---|---|
| `UsersController` | `/users/me` (GET, PATCH), `/users/me/dashboard` |
| `UsersService` | Profile CRUD, dashboard data assembly |

**Exports:** `UsersService` (used by AuthModule, ReferralsModule, AdminModule)

---

### 2.4 CampaignsModule

**Responsibilities:** Campaign listing, creation, detail, status updates.

| Component | Role |
|---|---|
| `CampaignsController` | `/campaigns`, `/campaigns/:id`, `/campaigns/mine`, `/campaigns/:id/status` |
| `CampaignsService` | Business validations (budget, URL, tier), budget escrow, campaign queries |

**Imports:** `WalletModule` (for budget escrow debit on campaign creation)

**Note on route ordering:** `/campaigns/mine` must be registered **before** `/campaigns/:id` in the controller to avoid NestJS matching `mine` as an `:id` param.

---

### 2.5 VisitsModule

**Responsibilities:** Visit start/complete with server-side time tracking and fraud prevention.

| Component | Role |
|---|---|
| `VisitsController` | `/visits/start`, `/visits/:id/complete`, `/visits/history` |
| `VisitsService` | Server-time validation, DB transaction for atomic credit/debit |

**Imports:** `WalletModule`, `CampaignsModule`, `ReferralsModule` (for milestone 2 check)

---

### 2.6 WalletModule

**Responsibilities:** Balance, deposits, withdrawals, transactions, bank accounts.

| Component | Role |
|---|---|
| `WalletController` | All `/wallet/*` endpoints |
| `WalletService` | Paystack calls, wallet mutations, bank verification |

**Exports:** `WalletService` (used by VisitsModule, ReferralsModule, AdminModule)

---

### 2.7 ReferralsModule

**Responsibilities:** Referral dashboard, milestone bonus crediting.

| Component | Role |
|---|---|
| `ReferralsController` | `/referrals` |
| `ReferralsService` | Milestone checks, masked name formatting, referral stats |

**Exports:** `ReferralsService` (used by AuthModule for new-user referral linking, VisitsModule for M2 check)

---

### 2.8 PlatformModule

**Responsibilities:** Public platform stats and config — no auth required, cached.

| Component | Role |
|---|---|
| `PlatformController` | `/platform/stats`, `/platform/config` |

Uses `@CacheKey` + `@CacheTTL` (5 min for stats) from `@nestjs/cache-manager`.

---

### 2.9 AdminModule

**Responsibilities:** All `/admin/*` endpoints — protected by `RolesGuard` with `@Roles('admin')`.

| Component | Role |
|---|---|
| `AdminController` | Campaign review, user block, list users, withdrawals, analytics |
| `AdminService` | Admin business logic, session invalidation on block |

---

### 2.10 WebhooksModule

**Responsibilities:** Paystack webhook ingestion.

| Component | Role |
|---|---|
| `PaystackWebhookController` | `POST /webhooks/paystack` — HMAC verify then delegate |

**Critical:** Must consume raw body (not parsed JSON) for HMAC verification. Use `bodyParser.raw` on this route.

---

### 2.11 Shared: PaystackModule

```typescript
@Global()
@Module({
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
```

`PaystackService` wraps all Paystack REST calls. Imported once at the AppModule level and available everywhere.

---

## 3. Database Schema (Entities)

> **ORM:** TypeORM with PostgreSQL. All primary keys are UUIDs. All monetary amounts stored as `bigint` **in kobo** (e.g. ₦15,000 = 1,500,000). No decimal types are used for money — this eliminates floating point precision issues entirely. Division by 100 for display formatting is handled on the frontend only.

---

### 3.1 User

```typescript
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) googleId: string;
  @Column({ unique: true }) email: string;
  @Column() fullName: string;
  @Column({ nullable: true }) avatarUrl: string;
  @Column({ nullable: true }) phone: string;
  @Column({ unique: true }) referralCode: string;        // e.g. ALEX8821
  @Column({ nullable: true }) referredById: string;      // FK to User (self-ref)
  @Column({ default: false }) isDeposited: boolean;
  @Column({ default: false }) isBlocked: boolean;
  @Column({ nullable: true }) blockedReason: string;
  @Column({ type: 'timestamp', nullable: true }) blockedAt: Date;
  @Column({ type: 'enum', enum: Role, default: Role.USER }) role: Role;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  // Relations
  @OneToOne(() => Wallet, (w) => w.user) wallet: Wallet;
  @OneToMany(() => Campaign, (c) => c.advertiser) campaigns: Campaign[];
  @OneToMany(() => Visit, (v) => v.user) visits: Visit[];
  @OneToMany(() => BankAccount, (b) => b.user) bankAccounts: BankAccount[];
  @OneToMany(() => RefreshToken, (r) => r.user) refreshTokens: RefreshToken[];
}
```

---

### 3.2 RefreshToken

```typescript
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() tokenHash: string;          // bcrypt hash of the raw token
  @Column({ type: 'timestamp' }) expiresAt: Date;
  @Column({ default: false }) isRevoked: boolean;
  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => User, (u) => u.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
```

---

### 3.3 Campaign

```typescript
@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() advertiserId: string;
  @Column() name: string;
  @Column() url: string;
  @Column('text') description: string;
  @Column({ type: 'enum', enum: CampaignType }) campaignType: CampaignType;  // blog | youtube
  @Column({ type: 'enum', enum: PricingTier }) pricingTier: PricingTier;    // economy | standard | premium
  @Column('bigint') payPerVisit: number;                     // in kobo
  @Column() minDuration: number;         // seconds: 30 | 60 | 120 | 180 | 300
  @Column() totalVisits: number;
  @Column({ default: 0 }) completedVisits: number;
  @Column('bigint') budget: number;                          // in kobo
  @Column('bigint', { default: 0 }) spent: number;          // in kobo
  @Column({ nullable: true }) icon: string;
  @Column({ nullable: true }) bgColor: string;
  @Column({ nullable: true }) fgColor: string;
  @Column({ nullable: true }) badge: string;
  @Column({ nullable: true }) badgeLabel: string;
  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.PENDING_REVIEW })
  status: CampaignStatus;
  @Column({ nullable: true }) reviewedById: string;
  @Column({ type: 'timestamp', nullable: true }) reviewedAt: Date;
  @Column({ nullable: true }) rejectionReason: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  @ManyToOne(() => User, (u) => u.campaigns)
  @JoinColumn({ name: 'advertiserId' })
  advertiser: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: User;

  @OneToMany(() => Visit, (v) => v.campaign) visits: Visit[];
}
```

---

### 3.4 Visit

```typescript
@Entity('visits')
export class Visit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() campaignId: string;
  @Column({ type: 'timestamp' }) serverStartTime: Date;
  @Column({ type: 'timestamp', nullable: true }) serverEndTime: Date;
  @Column({ nullable: true }) clientDuration: number;   // debug only, never trusted
  @Column('bigint', { nullable: true }) earned: number;      // in kobo
  @Column({ type: 'enum', enum: VisitStatus, default: VisitStatus.IN_PROGRESS })
  status: VisitStatus;                                  // in_progress | completed | abandoned
  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => User, (u) => u.visits)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Campaign, (c) => c.visits)
  @JoinColumn({ name: 'campaignId' })
  campaign: Campaign;

  // Non-unique composite index for query performance
  @Index(['userId', 'campaignId'])
}

// IMPORTANT: Add a partial unique index via migration (TypeORM decorators don't support partial indexes):
// CREATE UNIQUE INDEX idx_visit_user_campaign_completed
//   ON visits ("userId", "campaignId") WHERE status = 'completed';
// This enforces one completed visit per user per campaign at the DB level.
```

---

### 3.5 Wallet

```typescript
@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) userId: string;
  @Column('bigint', { default: 0 }) balance: number;         // in kobo
  @Column('bigint', { default: 0 }) totalEarned: number;     // in kobo
  @Column('bigint', { default: 0 }) totalWithdrawn: number;  // in kobo
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  @OneToOne(() => User) @JoinColumn({ name: 'userId' }) user: User;
  @OneToMany(() => Transaction, (t) => t.wallet) transactions: Transaction[];
}
```

---

### 3.6 Transaction

```typescript
@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() walletId: string;
  @Column({ type: 'enum', enum: TransactionType }) type: TransactionType;
  // TransactionType: deposit | withdrawal | earning | referral_bonus | campaign_escrow
  @Column('bigint') amount: number;                          // in kobo
  @Column() description: string;
  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;                            // pending | successful | failed
  @Column({ nullable: true, unique: true }) paystackReference: string;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => Wallet, (w) => w.transactions)
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;
}
```

---

### 3.7 BankAccount

```typescript
@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() bankCode: string;
  @Column() bankName: string;
  @Column() accountNumber: string;
  @Column() accountName: string;           // verified via Paystack resolve
  @Column({ default: false }) isDefault: boolean;
  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => User, (u) => u.bankAccounts)
  @JoinColumn({ name: 'userId' })
  user: User;
}
```

---

### 3.8 Withdrawal

```typescript
@Entity('withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column() bankAccountId: string;
  @Column({ nullable: true }) transactionId: string;
  @Column('bigint') amount: number;                          // in kobo
  @Column({ type: 'enum', enum: WithdrawalStatus, default: WithdrawalStatus.PROCESSING })
  status: WithdrawalStatus;                             // processing | completed | failed
  @Column({ nullable: true }) paystackTransferCode: string;
  @Column({ nullable: true }) processedById: string;
  @Column({ type: 'timestamp', nullable: true }) processedAt: Date;
  @Column({ nullable: true }) failureReason: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  @ManyToOne(() => User) @JoinColumn({ name: 'userId' }) user: User;
  @ManyToOne(() => BankAccount) @JoinColumn({ name: 'bankAccountId' }) bankAccount: BankAccount;
  @OneToOne(() => Transaction) @JoinColumn({ name: 'transactionId' }) transaction: Transaction;
  @ManyToOne(() => User) @JoinColumn({ name: 'processedById' }) processedBy: User;
}
```

---

### 3.9 Referral

```typescript
@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() referrerId: string;
  @Column({ unique: true }) refereeId: string;         // one referral record per referee
  @Column({ default: false }) milestone1Credited: boolean;
  @Column({ type: 'timestamp', nullable: true }) milestone1CreditedAt: Date;
  @Column({ default: false }) milestone2Credited: boolean;
  @Column({ type: 'timestamp', nullable: true }) milestone2CreditedAt: Date;
  @Column('bigint', { default: 0 }) totalEarned: number;    // in kobo
  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => User) @JoinColumn({ name: 'referrerId' }) referrer: User;
  @ManyToOne(() => User) @JoinColumn({ name: 'refereeId' }) referee: User;
}
```

---

## 4. Guards & Middleware Pipeline

Every authenticated request passes through this stack **in order**:

```
Incoming Request
   │
   ▼
[1] ThrottlerGuard         — IP-level rate limiting (100 req/min global)
   │
   ▼
[2] CORS                   — Whitelist: trafficpay.ng + localhost dev origins
   │
   ▼
[3] JwtAuthGuard           — Verify Bearer JWT (via JwtStrategy)
   │                          Skip if @Public() decorator present
   ▼
[4] BlockGuard             — Load user from DB, throw 403 if isBlocked
   │
   ▼
[5] RolesGuard             — Check role === 'admin' if @Roles('admin') present
   │
   ▼
[6] DepositGuard           — Check isDeposited if @RequiresDeposit() present
   │                          (visits endpoints only)
   ▼
[7] ValidationPipe         — class-validator on DTOs
   │
   ▼
[8] Route Handler          — Controller → Service → Repository
```

### Guard Implementations

```typescript
// common/guards/block.guard.ts
// NOTE: request.user is a fresh User entity loaded from DB by JwtStrategy.validate(),
// so isBlocked/isDeposited/role always reflect current state — not stale JWT claims.
@Injectable()
export class BlockGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true;                   // public route, JwtAuthGuard handles this
    if (user.isBlocked) {
      throw new ForbiddenException({
        code: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked.',
      });
    }
    return true;
  }
}

// common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(), context.getClass(),
    ]);
    if (!roles) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!roles.includes(user?.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient role.' });
    }
    return true;
  }
}

// common/guards/deposit.guard.ts
@Injectable()
export class DepositGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const requiresDeposit = this.reflector.getAllAndOverride<boolean>('requiresDeposit', [
      context.getHandler(), context.getClass(),
    ]);
    if (!requiresDeposit) return true;       // only enforce on @RequiresDeposit() routes

    const { user } = context.switchToHttp().getRequest();
    if (!user?.isDeposited) {
      throw new ForbiddenException({
        code: 'DEPOSIT_REQUIRED',
        message: 'You must make a deposit before visiting campaigns.',
      });
    }
    return true;
  }
}
```

### Custom Decorators

```typescript
// @Public() — skips JwtAuthGuard
export const Public = () => SetMetadata('isPublic', true);

// @Roles('admin') — triggers RolesGuard
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// @CurrentUser() — extracts user from request
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);

// @RequiresDeposit() — triggers DepositGuard
export const RequiresDeposit = () => SetMetadata('requiresDeposit', true);
```

---

## 5. DTOs & Validation

### Auth DTOs

```typescript
// google-signin.dto.ts
export class GoogleSignInDto {
  @IsString() @IsNotEmpty() idToken: string;
  @IsOptional() @IsString() referralCode?: string;
}

// refresh-token.dto.ts
export class RefreshTokenDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}
```

### Campaign DTOs

```typescript
// create-campaign.dto.ts
export class CreateCampaignDto {
  @IsString() @MaxLength(100) name: string;
  @IsUrl() url: string;
  @IsString() description: string;
  @IsEnum(CampaignType) campaignType: CampaignType;
  @IsIn([30, 60, 120, 180, 300]) minDuration: number;
  @IsInt() @Min(1) totalVisits: number;
  @IsEnum(PricingTier) pricingTier: PricingTier;
  @IsInt() @Min(1500000) budget: number;   // in kobo (₦15,000 minimum)
}
// NOTE: CampaignsService.createCampaign() must validate that:
//   budget >= totalVisits * payPerVisit(pricingTier)
// This cannot be expressed with class-validator alone because payPerVisit
// is derived from the pricingTier lookup. Reject with VALIDATION_ERROR if insufficient.
```

### Visit DTOs

```typescript
// start-visit.dto.ts
export class StartVisitDto {
  @IsUUID() campaignId: string;
}

// complete-visit.dto.ts
export class CompleteVisitDto {
  @IsUUID() visitId: string;
  @IsInt() @Min(0) clientDuration: number;     // for debug logging only
}
```

### Wallet DTOs

```typescript
// initialize-deposit.dto.ts
export class InitializeDepositDto {
  @IsInt() @Min(1500000) amount: number;   // in kobo (₦15,000 minimum)
  @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
}

// withdraw.dto.ts
export class WithdrawDto {
  @IsInt() @Min(500000) amount: number;    // in kobo (₦5,000 minimum)
  @IsUUID() bankAccountId: string;
}

// add-bank-account.dto.ts
export class AddBankAccountDto {
  @IsString() @IsNotEmpty() bankCode: string;
  @IsString() @Length(10, 10) accountNumber: string;
  @IsString() @IsNotEmpty() accountName: string;
}
```

---

## 6. Key Service Logic

### 6.1 AuthService

```typescript
async googleSignIn(dto: GoogleSignInDto): Promise<SignInResult> {
  // 1. Verify Google token
  const payload = await this.googleOAuthService.verifyIdToken(dto.idToken);
  // GoogleOAuthService checks: aud === GOOGLE_CLIENT_ID, iss === accounts.google.com

  // 2. Find or create user
  let user = await this.usersService.findByGoogleId(payload.sub);
  let isNewUser = false;

  if (!user) {
    // Validate referral code if provided
    let referrer: User | null = null;
    if (dto.referralCode) {
      referrer = await this.usersService.findByReferralCode(dto.referralCode);
      if (!referrer) throw new BadRequestException({ code: 'INVALID_REFERRAL_CODE' });
    }
    user = await this.usersService.create({
      googleId: payload.sub,
      email: payload.email,
      fullName: payload.name,
      avatarUrl: payload.picture,
      referralCode: await this.generateUniqueReferralCode(payload.name), // retries on collision
      referredById: referrer?.id ?? null,
    });
    // Create wallet record for new user
    await this.walletService.createWallet(user.id);
    // Link referral record
    if (referrer) await this.referralsService.createReferralRecord(referrer.id, user.id);
    isNewUser = true;
  }

  // 3. Check block
  if (user.isBlocked) throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED' });

  // 4. Issue tokens
  const { accessToken, refreshToken } = await this.issueTokenPair(user);
  return { user, accessToken, refreshToken, isNewUser };
}

async refreshTokens(rawRefreshToken: string) {
  const hash = this.hashToken(rawRefreshToken);
  const record = await this.refreshTokenRepo.findOne({ where: { tokenHash: hash, isRevoked: false } });
  if (!record || record.expiresAt < new Date()) throw new UnauthorizedException();

  const user = await this.usersService.findById(record.userId);
  if (user.isBlocked) throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED' });

  // Rotate: revoke old, issue new pair
  await this.refreshTokenRepo.update(record.id, { isRevoked: true });
  return this.issueTokenPair(user);
}

async logout(userId: string, rawRefreshToken: string) {
  const hash = this.hashToken(rawRefreshToken);
  await this.refreshTokenRepo.update({ userId, tokenHash: hash }, { isRevoked: true });
}

// Called by AdminService when blocking a user — invalidate ALL sessions
async revokeAllUserSessions(userId: string) {
  await this.refreshTokenRepo.update({ userId }, { isRevoked: true });
}

// Generate referral code with collision retry (e.g. ALEX8821)
private async generateUniqueReferralCode(name: string, maxRetries = 5): Promise<string> {
  const prefix = name.replace(/\s+/g, '').slice(0, 4).toUpperCase();
  for (let i = 0; i < maxRetries; i++) {
    const suffix = Math.floor(1000 + Math.random() * 9000); // 4-digit random
    const code = `${prefix}${suffix}`;
    const existing = await this.usersService.findByReferralCode(code);
    if (!existing) return code;
  }
  // Fallback: use nanoid for guaranteed uniqueness
  return `${prefix}${nanoid(6).toUpperCase()}`;
}
```

---

### 6.2 CampaignsService — Campaign Creation with Budget Escrow

```typescript
async createCampaign(userId: string, dto: CreateCampaignDto) {
  const payPerVisit = this.getPayPerVisit(dto.pricingTier);
  const requiredBudget = dto.totalVisits * payPerVisit;

  // Validate budget covers all visits
  if (dto.budget < requiredBudget) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `Budget must be at least ${requiredBudget} kobo (${dto.totalVisits} visits × ${payPerVisit} kobo).`,
    });
  }

  // Escrow: debit advertiser wallet atomically
  return await this.dataSource.transaction(async (manager) => {
    const debitResult = await manager.getRepository(Wallet)
      .createQueryBuilder()
      .update()
      .set({ balance: () => 'balance - :budget' })
      .setParameter('budget', dto.budget)
      .where('userId = :userId AND balance >= :budget', { userId, budget: dto.budget })
      .execute();

    if (debitResult.affected === 0) {
      throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'Insufficient wallet balance for campaign budget.' });
    }

    // Create escrow transaction record
    await manager.getRepository(Transaction).save({
      userId, type: TransactionType.CAMPAIGN_ESCROW, amount: dto.budget,
      status: TransactionStatus.SUCCESSFUL,
      description: `Campaign budget escrow: ${dto.name}`,
    });

    // Create campaign (pending review)
    const campaign = manager.getRepository(Campaign).create({
      advertiserId: userId,
      ...dto,
      payPerVisit,
      status: CampaignStatus.PENDING_REVIEW,
    });
    return await manager.getRepository(Campaign).save(campaign);
  });
}

// NOTE: If a campaign is REJECTED by admin, refund the escrowed budget to the advertiser's wallet.
// AdminService.reviewCampaign() must handle this refund when dto.action === 'reject'.
```

---

### 6.3 VisitsService (Critical — Fraud Prevention)

```typescript
async startVisit(userId: string, dto: StartVisitDto): Promise<StartVisitResult> {
  const campaign = await this.campaignsService.findActiveById(dto.campaignId);
  if (!campaign) throw new NotFoundException({ code: 'NOT_FOUND' });
  if (campaign.status !== CampaignStatus.ACTIVE) throw new GoneException({ code: 'GONE' });
  if (campaign.completedVisits >= campaign.totalVisits) throw new GoneException({ code: 'GONE' });

  // Block self-visits
  if (campaign.advertiserId === userId) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot visit your own campaign.' });
  }

  // Auto-abandon stale in-progress visits (older than 2× the campaign's max duration, capped at 10 min)
  // This prevents users from being permanently blocked if they abandon a visit without completing it.
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
  await this.visitRepo
    .createQueryBuilder()
    .update()
    .set({ status: VisitStatus.ABANDONED })
    .where('userId = :userId AND status = :status AND "serverStartTime" < :threshold', {
      userId,
      status: VisitStatus.IN_PROGRESS,
      threshold: staleThreshold,
    })
    .execute();

  // Check for active in-progress visit (after stale cleanup)
  const activeVisit = await this.visitRepo.findOne({
    where: { userId, status: VisitStatus.IN_PROGRESS },
  });
  if (activeVisit) throw new ConflictException({ code: 'CONFLICT', message: 'You already have an active visit.' });

  // Check if already completed this campaign
  const existingCompleted = await this.visitRepo.findOne({
    where: { userId, campaignId: dto.campaignId, status: VisitStatus.COMPLETED },
  });
  if (existingCompleted) throw new ConflictException({ code: 'CONFLICT', message: 'Already completed this campaign.' });

  const visit = this.visitRepo.create({
    userId,
    campaignId: dto.campaignId,
    serverStartTime: new Date(),
    status: VisitStatus.IN_PROGRESS,
  });
  await this.visitRepo.save(visit);

  return { visitId: visit.id, campaignId: campaign.id, minDuration: campaign.minDuration, serverStartTime: visit.serverStartTime };
}

async completeVisit(userId: string, visitId: string, clientDuration: number) {
  const visit = await this.visitRepo.findOne({ where: { id: visitId }, relations: ['campaign'] });
  if (!visit) throw new NotFoundException({ code: 'NOT_FOUND' });
  if (visit.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN' });

  // Idempotency: already completed
  if (visit.status === VisitStatus.COMPLETED) {
    const wallet = await this.walletService.getWallet(userId);
    return { visitId, earned: visit.earned, newWalletBalance: wallet.balance, campaignName: visit.campaign.name };
  }

  // SERVER-SIDE time check — clientDuration is NEVER trusted
  const serverElapsed = (Date.now() - visit.serverStartTime.getTime()) / 1000;
  if (serverElapsed < visit.campaign.minDuration) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Minimum visit duration not met.' });
  }

  const earned = visit.campaign.payPerVisit;
  const serverEndTime = new Date();

  // ATOMIC DB TRANSACTION — row-level locks to prevent race conditions
  const result = await this.dataSource.transaction(async (manager) => {
    // Lock visit row
    const lockedVisit = await manager
      .getRepository(Visit)
      .createQueryBuilder('v')
      .setLock('pessimistic_write')
      .where('v.id = :id', { id: visitId })
      .getOne();

    if (lockedVisit.status === VisitStatus.COMPLETED) {
      // Race condition safety: already credited by concurrent request
      const wallet = await manager.getRepository(Wallet).findOneBy({ userId });
      return { visitId, earned: lockedVisit.earned, newWalletBalance: wallet.balance, campaignName: visit.campaign.name, alreadyCompleted: true };
    }

    // 1. Claim a campaign slot FIRST (before crediting wallet).
    //    This avoids needing to reverse wallet credits if slots are exhausted.
    const campaignUpdate = await manager.getRepository(Campaign)
      .createQueryBuilder()
      .update()
      .set({
        spent: () => 'spent + :earned',
        completedVisits: () => '"completedVisits" + 1',
      })
      .setParameter('earned', earned)
      .where('id = :id AND "completedVisits" < "totalVisits"', { id: visit.campaignId })
      .execute();

    // If no rows affected, campaign slots were exhausted by a concurrent request.
    if (campaignUpdate.affected === 0) {
      await manager.getRepository(Visit).update(visitId, { status: VisitStatus.ABANDONED });
      return { visitId, earned: 0, newWalletBalance: 0, campaignName: visit.campaign.name, alreadyCompleted: false, slotsExhausted: true };
    }

    // 2. Mark visit completed
    await manager.getRepository(Visit).update(visitId, {
      status: VisitStatus.COMPLETED,
      serverEndTime,
      clientDuration,
      earned,
    });

    // 3. Credit earner wallet (parameterized to avoid SQL injection)
    await manager.getRepository(Wallet)
      .createQueryBuilder()
      .update()
      .set({
        balance: () => 'balance + :earned',
        totalEarned: () => '"totalEarned" + :earned',
      })
      .setParameter('earned', earned)
      .where('userId = :userId', { userId })
      .execute();

    // 4. Create earning transaction record
    await manager.getRepository(Transaction).save({
      userId, type: TransactionType.EARNING, amount: earned, status: TransactionStatus.SUCCESSFUL,
      description: `Earned from visiting ${visit.campaign.name}`,
    });

    // 5. Auto-complete campaign if slots exhausted
    const updatedCampaign = await manager.getRepository(Campaign).findOneBy({ id: visit.campaignId });
    if (updatedCampaign.completedVisits >= updatedCampaign.totalVisits) {
      await manager.getRepository(Campaign).update(visit.campaignId, { status: CampaignStatus.COMPLETED });
    }

    // 6. Read final balance
    const updatedWallet = await manager.getRepository(Wallet).findOneBy({ userId });

    return { visitId, earned, newWalletBalance: updatedWallet.balance, campaignName: visit.campaign.name, alreadyCompleted: false };
  });

  // If slots were exhausted after we started, inform the client
  if (result.slotsExhausted) {
    throw new GoneException({ code: 'GONE', message: 'Campaign slots exhausted.' });
  }

  // Trigger async milestone 2 check (outside transaction, non-blocking)
  if (!result.alreadyCompleted) {
    this.referralMilestoneQueue.add('check-milestone-2', { userId });
  }

  return result;
}
```

---

### 6.4 WalletService

```typescript
async initializeDeposit(userId: string, dto: InitializeDepositDto) {
  const user = await this.usersService.findById(userId);
  const reference = `TXN_${nanoid(12)}`;

  // Call Paystack
  const paystackData = await this.paystackService.initializeTransaction({
    email: user.email,
    amount: dto.amount,             // already in kobo
    reference,
    callback_url: `${this.config.get('frontendUrl')}/payment/success`,
    metadata: { userId },
  });

  // Store pending transaction
  await this.transactionRepo.save({
    userId, type: TransactionType.DEPOSIT, amount: dto.amount,
    status: TransactionStatus.PENDING, paystackReference: reference,
    description: 'Wallet deposit',
  });

  return { transactionRef: reference, authorizationUrl: paystackData.authorization_url, accessCode: paystackData.access_code, amount: dto.amount };
}

async verifyDeposit(userId: string, transactionRef: string) {
  const txn = await this.transactionRepo.findOne({ where: { paystackReference: transactionRef, userId } });
  if (!txn) throw new NotFoundException({ code: 'NOT_FOUND' });
  if (txn.status === TransactionStatus.SUCCESSFUL) {
    // Already processed (idempotent)
    const wallet = await this.getWallet(userId);
    return { status: 'successful', amount: txn.amount, newBalance: wallet.balance, isDeposited: true };
  }

  const paystackData = await this.paystackService.verifyTransaction(transactionRef);
  if (paystackData.status !== 'success') return { status: paystackData.status };

  await this.creditWalletFromDeposit(userId, txn.id, txn.amount);
  const wallet = await this.getWallet(userId);
  return { status: 'successful', amount: txn.amount, newBalance: wallet.balance, isDeposited: true };
}

async handlePaystackWebhook(event: string, data: PaystackWebhookData) {
  switch (event) {
    case 'charge.success':
      return this.handleChargeSuccess(data);
    case 'transfer.success':
      return this.handleTransferSuccess(data);
    case 'transfer.failed':
    case 'transfer.reversed':
      return this.handleTransferFailed(data);
    default:
      this.logger.log({ event: 'webhook_unhandled_event', paystackEvent: event });
      return;
  }
}

private async handleChargeSuccess(data: PaystackWebhookData) {
  const reference = data.reference;
  const amountKobo = data.amount;        // Paystack sends kobo; store as-is
  const userId = data.metadata?.userId;

  // Idempotency: abort if already credited
  const txn = await this.transactionRepo.findOne({ where: { paystackReference: reference } });
  if (!txn || txn.status === TransactionStatus.SUCCESSFUL) return;

  // Amount validation — reject mismatches but log for admin review instead of hard-failing
  if (Number(txn.amount) !== Number(amountKobo)) {
    this.logger.warn({ event: 'webhook_amount_mismatch', reference, expected: txn.amount, received: amountKobo });
    await this.transactionRepo.update(txn.id, {
      status: TransactionStatus.FAILED,
      metadata: { ...txn.metadata, reason: 'amount_mismatch', paystackAmount: amountKobo },
    });
    return;
  }

  await this.creditWalletFromDeposit(userId ?? txn.userId, txn.id, amountKobo);
}

private async handleTransferSuccess(data: PaystackWebhookData) {
  const transferCode = data.transfer_code;
  const withdrawal = await this.withdrawalRepo.findOne({ where: { paystackTransferCode: transferCode } });
  if (!withdrawal || withdrawal.status === WithdrawalStatus.COMPLETED) return; // idempotent

  await this.dataSource.transaction(async (manager) => {
    await manager.getRepository(Withdrawal).update(withdrawal.id, {
      status: WithdrawalStatus.COMPLETED,
      processedAt: new Date(),
    });
    await manager.getRepository(Transaction).update(withdrawal.transactionId, {
      status: TransactionStatus.SUCCESSFUL,
    });
  });
}

private async handleTransferFailed(data: PaystackWebhookData) {
  const transferCode = data.transfer_code;
  const withdrawal = await this.withdrawalRepo.findOne({ where: { paystackTransferCode: transferCode } });
  if (!withdrawal || withdrawal.status !== WithdrawalStatus.PROCESSING) return;

  await this.dataSource.transaction(async (manager) => {
    // Mark withdrawal as failed
    await manager.getRepository(Withdrawal).update(withdrawal.id, {
      status: WithdrawalStatus.FAILED,
      failureReason: data.reason ?? 'Transfer failed or reversed',
    });
    await manager.getRepository(Transaction).update(withdrawal.transactionId, {
      status: TransactionStatus.FAILED,
    });
    // Refund the amount back to the user's wallet
    await manager.getRepository(Wallet)
      .createQueryBuilder()
      .update()
      .set({
        balance: () => 'balance + :amount',
        totalWithdrawn: () => '"totalWithdrawn" - :amount',
      })
      .setParameter('amount', withdrawal.amount)
      .where('userId = :userId', { userId: withdrawal.userId })
      .execute();
  });
}

private async creditWalletFromDeposit(userId: string, txnId: string, amount: number) {
  await this.dataSource.transaction(async (manager) => {
    await manager.getRepository(Wallet)
      .createQueryBuilder()
      .update()
      .set({ balance: () => 'balance + :amount' })
      .setParameter('amount', amount)
      .where('userId = :userId', { userId })
      .execute();
    await manager.getRepository(Transaction).update(txnId, { status: TransactionStatus.SUCCESSFUL });
    // Set isDeposited = true on first deposit
    await manager.getRepository(User).createQueryBuilder()
      .update()
      .set({ isDeposited: true })
      .where('id = :userId AND "isDeposited" = false', { userId })
      .execute();
  });
  // Trigger referral milestone 1 check
  this.referralMilestoneQueue.add('check-milestone-1', { userId });
}

async requestWithdrawal(userId: string, dto: WithdrawDto) {
  const wallet = await this.getWallet(userId);
  if (wallet.balance < dto.amount) throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE' });
  const bankAccount = await this.bankAccountRepo.findOne({ where: { id: dto.bankAccountId, userId } });
  if (!bankAccount) throw new NotFoundException({ code: 'NOT_FOUND' });

  return await this.dataSource.transaction(async (manager) => {
    // Debit wallet (parameterized, with affected-row check)
    const debitResult = await manager.getRepository(Wallet)
      .createQueryBuilder().update()
      .set({
        balance: () => 'balance - :amount',
        totalWithdrawn: () => '"totalWithdrawn" + :amount',
      })
      .setParameter('amount', dto.amount)
      .where('userId = :userId AND balance >= :amount', { userId, amount: dto.amount })
      .execute();

    // If no rows affected, balance was drained by a concurrent request
    if (debitResult.affected === 0) {
      throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance.' });
    }

    // Create transaction record
    const txn = await manager.getRepository(Transaction).save({
      userId, type: TransactionType.WITHDRAWAL, amount: dto.amount,
      status: TransactionStatus.PENDING, description: `Withdrawal to ${bankAccount.bankName} ${bankAccount.accountNumber}`,
    });

    // Create withdrawal record
    const withdrawal = await manager.getRepository(Withdrawal).save({
      userId, bankAccountId: dto.bankAccountId, transactionId: txn.id,
      amount: dto.amount, status: WithdrawalStatus.PROCESSING,
    });

    return withdrawal;
  }).then(async (withdrawal) => {
    // Amounts > ₦100,000 (10,000,000 kobo) skip auto-transfer and go to admin review
    if (dto.amount > 10000000) {
      // Admin processes manually via /admin/withdrawals
    } else {
      await this.withdrawalQueue.add('process-transfer', { withdrawalId: withdrawal.id });
    }
    return { withdrawalId: withdrawal.id, amount: dto.amount, status: 'processing', estimatedCompletion: this.getEstimatedCompletion() };
  });
}
```

---

### 6.5 ReferralsService

```typescript
async checkAndCreditMilestone1(refereeId: string) {
  const referral = await this.referralRepo.findOne({ where: { refereeId } });
  if (!referral || referral.milestone1Credited) return;

  // Credit ₦3,750 to referrer
  await this.walletService.creditReferralBonus(referral.referrerId, 375000, `Referral milestone 1 — first deposit`);
  await this.referralRepo
    .createQueryBuilder()
    .update()
    .set({ milestone1Credited: true, milestone1CreditedAt: new Date(), totalEarned: () => '"totalEarned" + :bonus' })
    .setParameter('bonus', 375000)
    .where('id = :id', { id: referral.id })
    .execute();
}

async checkAndCreditMilestone2(refereeId: string) {
  const referral = await this.referralRepo.findOne({ where: { refereeId } });
  if (!referral || referral.milestone2Credited) return;

  // Count completed visits for referee
  const completedCount = await this.visitRepo.count({ where: { userId: refereeId, status: VisitStatus.COMPLETED } });
  if (completedCount < 10) return;

  await this.walletService.creditReferralBonus(referral.referrerId, 375000, `Referral milestone 2 — 10 tasks completed`);
  await this.referralRepo
    .createQueryBuilder()
    .update()
    .set({ milestone2Credited: true, milestone2CreditedAt: new Date(), totalEarned: () => '"totalEarned" + :bonus' })
    .setParameter('bonus', 375000)
    .where('id = :id', { id: referral.id })
    .execute();
}

// Mask name for privacy: "Chioma Eze" → "Chi***"
maskName(fullName: string): string {
  const first = fullName.split(' ')[0];
  return `${first.slice(0, 3)}***`;
}
```

---

### 6.6 AdminService

```typescript
async blockUser(adminId: string, userId: string, dto: BlockUserDto) {
  await this.usersRepo.update(userId, {
    isBlocked: dto.isBlocked,
    blockedReason: dto.isBlocked ? dto.reason : null,
    blockedAt: dto.isBlocked ? new Date() : null,
  });

  // IMMEDIATELY invalidate all sessions on block
  if (dto.isBlocked) {
    await this.authService.revokeAllUserSessions(userId);
  }

  // Audit log
  this.logger.log({ event: 'admin_block_user', adminId, targetUserId: userId, isBlocked: dto.isBlocked, reason: dto.reason });

  return { userId, isBlocked: dto.isBlocked, reason: dto.reason, blockedAt: new Date() };
}

async reviewCampaign(adminId: string, campaignId: string, dto: ReviewCampaignDto) {
  const campaign = await this.campaignRepo.findOneBy({ id: campaignId });
  if (!campaign) throw new NotFoundException({ code: 'NOT_FOUND' });
  if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
    throw new ConflictException({ code: 'CONFLICT', message: 'Campaign already reviewed.' });
  }

  const newStatus = dto.action === 'approve' ? CampaignStatus.ACTIVE : CampaignStatus.REJECTED;

  await this.dataSource.transaction(async (manager) => {
    await manager.getRepository(Campaign).update(campaignId, {
      status: newStatus,
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: dto.action === 'reject' ? dto.reason : null,
    });

    // Refund escrowed budget to advertiser on rejection
    if (dto.action === 'reject') {
      await manager.getRepository(Wallet)
        .createQueryBuilder()
        .update()
        .set({ balance: () => 'balance + :budget' })
        .setParameter('budget', campaign.budget)
        .where('userId = :userId', { userId: campaign.advertiserId })
        .execute();

      await manager.getRepository(Transaction).save({
        userId: campaign.advertiserId,
        type: TransactionType.CAMPAIGN_ESCROW,
        amount: campaign.budget,
        status: TransactionStatus.SUCCESSFUL,
        description: `Campaign budget refund (rejected): ${campaign.name}`,
      });
    }
  });

  this.logger.log({ event: 'admin_review_campaign', adminId, campaignId, action: dto.action });
}
```

---

## 7. Queue Design (BullMQ)

```typescript
// Four queues registered globally in AppModule
BullModule.registerQueue(
  { name: 'withdrawal-processing' },
  { name: 'referral-milestones' },
  { name: 'webhook-events' },
  { name: 'campaign-maintenance' },
)
```

### Queue: `withdrawal-processing`

| Job | Trigger | Handler |
|---|---|---|
| `process-transfer` | After withdrawal creation | Create Paystack transfer recipient, initiate transfer, update withdrawal status |

```typescript
@Processor('withdrawal-processing')
export class WithdrawalProcessor {
  @Process('process-transfer')
  async handleTransfer(job: Job<{ withdrawalId: string }>) {
    const withdrawal = await this.withdrawalRepo.findOne({ where: { id: job.data.withdrawalId }, relations: ['bankAccount'] });
    // 1. Create Paystack transfer recipient
    const recipient = await this.paystackService.createTransferRecipient(
      withdrawal.bankAccount.bankCode, withdrawal.bankAccount.accountNumber, withdrawal.bankAccount.accountName
    );
    // 2. Initiate transfer
    const transfer = await this.paystackService.initiateTransfer(
      withdrawal.amount,      // already in kobo
      recipient.recipient_code, `TrafficPay withdrawal`
    );
    // 3. Update withdrawal with transfer code
    await this.withdrawalRepo.update(withdrawal.id, { paystackTransferCode: transfer.transfer_code });
  }
}
```

### Queue: `referral-milestones`

| Job | Trigger | Handler |
|---|---|---|
| `check-milestone-1` | After first deposit credited | `ReferralsService.checkAndCreditMilestone1()` |
| `check-milestone-2` | After each visit completed | `ReferralsService.checkAndCreditMilestone2()` |

### Queue: `webhook-events`

| Job | Trigger | Handler |
|---|---|---|
| `paystack-charge-success` | Paystack webhook | Idempotent wallet credit |
| `paystack-transfer-success` | Paystack webhook | Mark withdrawal completed |
| `paystack-transfer-failed` | Paystack webhook | Mark withdrawal failed, refund wallet |

### Queue: `campaign-maintenance`

| Job | Trigger | Handler |
|---|---|---|
| `expire-stale-visits` | Scheduled (every 30 min via @Cron) | Mark `in_progress` visits older than 2× max duration as `abandoned` |

---

## 8. Caching Strategy (Redis)

| Cache Key | TTL | Invalidation Trigger |
|---|---|---|
| `platform:stats` | 5 minutes | Scheduled refresh |
| `platform:config` | 1 hour | Manual deploy / config update |
| `campaign:list:{hash(query)}` | 30 seconds | Campaign created, status changed |
| `user:blocked:{userId}` | 60 seconds | Admin block/unblock action |

```typescript
// platform.controller.ts
@Get('stats')
@Public()
@UseInterceptors(CacheInterceptor)
@CacheKey('platform:stats')
@CacheTTL(300)                       // 5 minutes
getPlatformStats() {
  return this.platformService.getStats();
}
```

---

## 9. Paystack Integration

```typescript
// shared/paystack/paystack.service.ts
@Injectable()
export class PaystackService {
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly headers: Record<string, string>;

  constructor(private config: ConfigService) {
    this.headers = {
      Authorization: `Bearer ${this.config.get('paystackSecretKey')}`,
      'Content-Type': 'application/json',
    };
  }

  // Helper: all Paystack calls go through this to ensure consistent error handling
  private async paystackRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok || !json.status) {
      this.logger.error({ event: 'paystack_api_error', path, status: res.status, message: json.message });
      throw new InternalServerErrorException(`Paystack error: ${json.message ?? res.statusText}`);
    }
    return json.data as T;
  }

  async initializeTransaction(payload: InitializeTxnPayload) {
    return this.paystackRequest('POST', '/transaction/initialize', payload);
  }

  async verifyTransaction(reference: string) {
    return this.paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async resolveAccount(accountNumber: string, bankCode: string) {
    const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    try {
      return await this.paystackRequest('GET', `/bank/resolve?${params}`);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Could not verify bank account.' });
    }
  }

  async createTransferRecipient(bankCode: string, accountNumber: string, accountName: string) {
    return this.paystackRequest('POST', '/transferrecipient', {
      type: 'nuban', bank_code: bankCode, account_number: accountNumber, name: accountName, currency: 'NGN',
    });
  }

  async initiateTransfer(amountKobo: number, recipientCode: string, reason: string) {
    return this.paystackRequest('POST', '/transfer', {
      source: 'balance', amount: amountKobo, recipient: recipientCode, reason,
    });
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    const hash = createHmac('sha512', this.config.get('paystackWebhookSecret'))
      .update(rawBody)
      .digest('hex');
    return hash === signatureHeader;
  }
}
```

### Webhook Controller

```typescript
// webhooks/paystack-webhook.controller.ts
@Controller('webhooks')
export class PaystackWebhookController {
  @Post('paystack')
  @Public()
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') signature: string) {
    const isValid = this.paystackService.verifyWebhookSignature(req.rawBody, signature);
    if (!isValid) throw new ForbiddenException('Invalid webhook signature');

    // Respond 200 immediately, process async
    const payload = JSON.parse(req.rawBody.toString());
    await this.webhookQueue.add(`paystack-${payload.event}`, payload.data);

    return { received: true };
  }
}
```

**Important:** In `main.ts`, raw body must be preserved on the webhook route.
Note: Express middleware runs **before** NestJS's global prefix, so the path must include `/v1`:
```typescript
app.use('/v1/webhooks/paystack', express.raw({ type: 'application/json' }));
```

---

## 10. Global Exception Filter & Response Interceptor

### Exception Filter

```typescript
// common/filters/http-exception.filter.ts
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      code = exceptionResponse?.code ?? this.statusToCode(statusCode);
      message = exceptionResponse?.message ?? exception.message;
    }

    response.status(statusCode).json({
      success: false,
      error: { code, message, statusCode },
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 410: 'GONE',
      422: 'UNPROCESSABLE_ENTITY', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'INTERNAL_ERROR';
  }
}
```

### Response Interceptor

```typescript
// common/interceptors/response.interceptor.ts
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({ success: true, data })),
    );
  }
}
```

---

## 11. Rate Limiting Configuration

Using `@nestjs/throttler` with per-endpoint overrides via `@Throttle()`:

```typescript
// Throttler registered globally in AppModule:
ThrottlerModule.forRoot([
  { name: 'global', ttl: 60000, limit: 100 },    // 100 req / 1 min per IP
])

// Auth endpoints
@Throttle({ default: { ttl: 300000, limit: 10 } })   // 10 req / 5 min
@Post('google')
googleSignIn() {}

// Visit start
@Throttle({ default: { ttl: 30000, limit: 1 } })     // 1 req / 30 sec per user
@Post('start')
startVisit() {}

// Deposit initialize
@Throttle({ default: { ttl: 900000, limit: 5 } })    // 5 req / 15 min per user
@Post('deposit/initialize')
initializeDeposit() {}

// Withdrawal
@Throttle({ default: { ttl: 3600000, limit: 3 } })   // 3 req / 1 hour per user
@Post('withdraw')
requestWithdrawal() {}

// Campaign creation
@Throttle({ default: { ttl: 3600000, limit: 10 } })  // 10 req / 1 hour per user
@Post()
createCampaign() {}
```

All throttle violations return `429` with `Retry-After` header.

---

## 12. Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/trafficpay

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_rs256_private_key
JWT_REFRESH_SECRET=your_rs256_refresh_private_key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Paystack
PAYSTACK_SECRET_KEY=sk_live_xxxx
PAYSTACK_WEBHOOK_SECRET=your_paystack_webhook_secret

# App
FRONTEND_URL=https://trafficpay.ng
CORS_ORIGINS=https://trafficpay.ng,http://localhost:3000

# Logging
LOG_LEVEL=info
```

```typescript
// config/configuration.ts
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  database: { url: process.env.DATABASE_URL, synchronize: false, logging: process.env.NODE_ENV !== 'production' },
  redisUrl: process.env.REDIS_URL,
  jwt: { secret: process.env.JWT_SECRET, refreshSecret: process.env.JWT_REFRESH_SECRET, accessExpiry: process.env.JWT_ACCESS_EXPIRY, refreshExpiry: process.env.JWT_REFRESH_EXPIRY },
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  paystackWebhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
  frontendUrl: process.env.FRONTEND_URL,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? [],
});
```

---

## 13. Bootstrap (main.ts)

```typescript
// main.ts
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,       // enables req.rawBody for webhook signature verification
  });

  const config = app.get(ConfigService);

  // CORS
  app.enableCors({
    origin: config.get('corsOrigins'),
    credentials: true,
  });

  // Raw body for Paystack webhook
  app.use('/v1/webhooks/paystack', express.raw({ type: 'application/json' }));

  // Global prefix
  app.setGlobalPrefix('v1');

  // Helmet for basic HTTP security headers
  app.use(helmet());

  // Swagger (dev only)
  if (config.get('nodeEnv') !== 'production') {
    const swaggerDoc = new DocumentBuilder()
      .setTitle('TrafficPay API')
      .setVersion('1.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerDoc));
  }

  await app.listen(config.get('port'));
}
bootstrap();
```

---

## 14. Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│            Next.js Web App  /  Future Mobile App                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (TLS 1.2+)
┌───────────────────────────▼─────────────────────────────────────┐
│                       REVERSE PROXY                             │
│                   Nginx / Caddy / Cloud LB                      │
│              SSL termination, rate limit at edge                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    NestJS APPLICATION                           │
│                   (Node.js, TypeScript)                         │
│                                                                 │
│   AuthModule  UsersModule  CampaignsModule  VisitsModule        │
│   WalletModule  ReferralsModule  PlatformModule  AdminModule    │
│   WebhooksModule  PaystackModule (shared)                       │
└──────────┬────────────────────┬────────────────────────────────┘
           │                    │
┌──────────▼──────┐   ┌─────────▼──────────────────────────────┐
│  PostgreSQL DB  │   │         Redis                           │
│                 │   │   - JWT refresh token store             │
│  - users        │   │   - BullMQ job queues                   │
│  - campaigns    │   │   - Response cache (stats, config)      │
│  - visits       │   │   - Rate limit counters                 │
│  - wallets      │   └─────────────────────────────────────────┘
│  - transactions │
│  - withdrawals  │   ┌─────────────────────────────────────────┐
│  - bank_accts   │   │        BullMQ Workers                   │
│  - referrals    │   │   - WithdrawalProcessor                 │
│  - refresh_tkns │   │   - ReferralMilestoneProcessor          │
└─────────────────┘   │   - WebhookEventProcessor               │
                      │   - CampaignMaintenanceProcessor        │
                      └───────────────┬─────────────────────────┘
                                      │
                      ┌───────────────▼─────────────────────────┐
                      │           Paystack API                  │
                      │   - Transaction initialize/verify       │
                      │   - Bank account resolution             │
                      │   - Transfer (withdrawal payout)        │
                      │   - Webhook events → /webhooks/paystack │
                      └─────────────────────────────────────────┘
```

### Recommended Deployment Stack

| Concern | Option |
|---|---|
| **Hosting** | Railway, Render, or AWS EC2/ECS |
| **Database** | Supabase (Postgres), Neon, or RDS |
| **Redis** | Upstash, Redis Cloud, or ElastiCache |
| **File storage** | Not required currently |
| **Logging** | Pino logger (NestJS) + Logtail / Grafana Loki |
| **Monitoring** | Sentry (errors) + Prometheus/Grafana (metrics) |
| **CI/CD** | GitHub Actions → deploy on merge to main |

---

## 15. Key Implementation Rules

These are the decisions that matter most for correctness, security, and anti-fraud:

### ✅ Authentication
- **Never trust** the Google `idToken` without server-side verification (check `aud`, `iss`).
- Use **RS256** JWT signing, not HS256.
- Store only the **hash** of refresh tokens in the database (bcrypt or SHA-256).
- `JwtStrategy.validate()` must **load the full User entity from DB** on every request — guards rely on fresh `isBlocked`, `isDeposited`, and `role` fields, not stale JWT claims.
- Check `isBlocked` on **every authenticated request** via `BlockGuard`, not just at login.
- Blocking a user must **immediately revoke all their refresh tokens**.
- `generateUniqueReferralCode()` must **retry on collision** — the `referralCode` column has a unique constraint, and a DB error during sign-up is unacceptable.

### ✅ Visit Fraud Prevention
- Server-side timing is the **only truth**. `clientDuration` is debug data — never use it for validation.
- The `completeVisit` transaction must use **row-level pessimistic locks** to prevent double-credit from concurrent requests.
- The campaign update in `completeVisit` must include `WHERE "completedVisits" < "totalVisits"` to prevent over-completion from concurrent requests. Check `affected === 0` and reject if slots are exhausted.
- Enforce **one in-progress visit per user** at all times. Auto-abandon stale visits (>10 min) inline during `startVisit` so users aren't permanently blocked.
- Enforce **one completed visit per user per campaign** via a **partial unique index** (`WHERE status = 'completed'`) + application-level query check.
- **Self-visit blocking** is not optional — advertisers cannot earn from their own campaigns.

### ✅ Payment Security
- Paystack webhooks must be verified via **HMAC SHA-512** before any processing.
- Use the **raw request body** (not parsed JSON) for webhook HMAC verification.
- All deposit and payout flows must be **idempotent** — check Paystack `reference` for prior processing.
- Store Paystack amounts **in kobo as `bigint`** — never use `decimal`/`float` for money. Paystack sends kobo natively; store it as-is. Naira display formatting (`÷ 100`) is the frontend's responsibility only.
- Withdrawals over **₦100,000** must not auto-process — they queue for admin review.

### ✅ Database Integrity
- Wallet mutations (credit/debit) must **always happen inside a transaction**.
- Use `UPDATE ... SET balance = balance + :amount WHERE userId = :userId AND balance >= :amount` for withdrawals to prevent negative balances atomically. **Always check `result.affected`** — if 0, the balance was insufficient (concurrent drain) and the transaction must abort.
- Campaign `completedVisits` and `spent` are updated in the **same transaction** as the wallet credit.
- **Never use string interpolation** in TypeORM `.set()` expressions for values. Always use `.setParameter()` to prevent SQL injection risks from future refactoring.
- All list endpoints (`/visits/history`, `/wallet/transactions`, `/campaigns`) must implement **cursor-based or offset pagination** to prevent unbounded result sets.

### ✅ Campaign Budget
- Campaign creation must **escrow the full budget** from the advertiser's wallet atomically. No campaign is created without the wallet debit succeeding.
- `CampaignsService.createCampaign()` must validate that `budget >= totalVisits * payPerVisit(pricingTier)` before proceeding.
- If a campaign is **rejected** by admin, the escrowed budget must be **refunded** to the advertiser's wallet in the same transaction as the status update.

### ✅ Referral System
- Milestone checks run **asynchronously** via BullMQ — never block the visit completion response.
- Each milestone bonus is credited exactly once — gate with `milestone1Credited` / `milestone2Credited` flags before crediting.
- Referee names are **always masked** in API responses exposed to other users (`Chi***`).

---

> **Total endpoints implemented: 32** | **Modules: 9** | **Entities: 9** | **BullMQ queues: 4**
