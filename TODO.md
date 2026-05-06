# TrafficPay Implementation TODO

## Phase 0 — Project Scaffold + Infrastructure
- [x] Initialize NestJS project
- [x] Install all dependencies
- [x] Create src/config/configuration.ts
- [x] Create .env and .env.example
- [x] Update src/main.ts (bootstrap with rawBody, CORS, helmet, swagger, global prefix)
- [x] Update src/app.module.ts (shell with ConfigModule, TypeOrmModule, ThrottlerModule, BullModule, CacheModule)

## Phase 1 — Common Layer
- [x] Create enums (role, campaign-status, campaign-type, pricing-tier, visit-status, transaction-type, transaction-status, withdrawal-status, payment-method)
- [x] Create decorators (public, roles, current-user, requires-deposit)
- [x] Create guards (jwt-auth, block, roles, deposit)
- [x] Create filters (http-exception)
- [x] Create interceptors (response)
- [x] Create pipes (validation — wired as APP_PIPE in app.module)
- [x] Create bigint transformer
- [x] Wire guards/filters/interceptors/pipes into app.module.ts

## Phase 2 — Database Entities + Migration
- [x] Create User entity
- [x] Create RefreshToken entity
- [x] Create Campaign entity
- [x] Create Visit entity
- [x] Create Wallet entity
- [x] Create Transaction entity
- [x] Create BankAccount entity
- [x] Create Withdrawal entity
- [x] Create Referral entity
- [ ] Generate and run initial migration
- [ ] Create partial unique index migration for visits

## Phase 3 — PaystackModule (Shared)
- [x] Create PaystackModule
- [x] Create PaystackService (paystackRequest helper, all API methods, webhook signature verification)

## Phase 4 — UsersModule
- [x] Create UsersModule
- [x] Create UsersService (findById, findByGoogleId, findByReferralCode, create, update, getDashboardStats)
- [x] Create UsersController (GET /users/me, PATCH /users/me, GET /users/me/dashboard)
- [x] Create UpdateProfileDto

## Phase 5 — WalletModule (Internal Operations + Deposits + Withdrawals)
- [x] Create WalletModule
- [x] Create WalletService (createWallet, getWallet, getBalance, creditReferralBonus, getTransactions, initializeDeposit, verifyDeposit, creditWalletFromDeposit, handlePaystackWebhook, requestWithdrawal, addBankAccount, getBankAccounts, removeBankAccount)
- [x] Create WalletController (all wallet endpoints)
- [x] Create all DTOs (ListTransactionsDto, InitializeDepositDto, VerifyDepositDto, WithdrawDto, AddBankAccountDto)

## Phase 6 — AuthModule
- [x] Create AuthModule
- [x] Create GoogleOAuthService
- [x] Create JwtStrategy (with DB user loading)
- [x] Create AuthService (googleSignIn, refreshTokens, logout, revokeAllUserSessions, generateUniqueReferralCode)
- [x] Create AuthController (POST /auth/google, POST /auth/refresh, POST /auth/logout)
- [x] Create GoogleSignInDto and RefreshTokenDto

## Phase 7 — CampaignsModule
- [x] Create CampaignsModule
- [x] Create CampaignsService (createCampaign, findActiveById, listCampaigns, listMyCampaigns, getPayPerVisit)
- [x] Create CampaignsController (GET /campaigns, GET /campaigns/mine, POST /campaigns, GET /campaigns/:id)
- [x] Create CreateCampaignDto, ListCampaignsDto, UpdateCampaignStatusDto

## Phase 8 — VisitsModule
- [x] Create VisitsModule
- [x] Create VisitsService (startVisit, completeVisit, getVisitHistory)
- [x] Create VisitsController (POST /visits/start, POST /visits/:id/complete, GET /visits/history)
- [x] Create StartVisitDto, CompleteVisitDto

## Phase 9-10 — WalletModule: Deposits + Withdrawals + Bank Accounts
- [x] (Merged into Phase 5 — all wallet functionality implemented together)

## Phase 11 — ReferralsModule
- [x] Create ReferralsModule
- [x] Create ReferralsService (createReferralRecord, checkAndCreditMilestone1/2, maskName, getReferralStats)
- [x] Create ReferralsController (GET /referrals)

## Phase 12 — BullMQ Processors
- [x] Create WithdrawalProcessor
- [x] Create WebhookEventProcessor
- [x] Create ReferralMilestoneProcessor
- [x] Create CampaignMaintenanceProcessor (with @Cron)
- [x] Create QueuesModule (with ScheduleModule.forRoot())

## Phase 13 — WebhooksModule
- [x] Create WebhooksModule
- [x] Create PaystackWebhookController (POST /webhooks/paystack)

## Phase 14 — PlatformModule
- [x] Create PlatformModule
- [x] Create PlatformService
- [x] Create PlatformController (GET /platform/stats, GET /platform/config)

## Phase 15 — AdminModule
- [x] Create AdminModule
- [x] Create AdminService (blockUser, reviewCampaign, listUsers, listPendingCampaigns, listWithdrawals, analytics)
- [x] Create AdminController (all /admin/* endpoints)
- [x] Create ReviewCampaignDto, BlockUserDto

## Final
- [x] Wire all feature modules into app.module.ts
- [x] TypeScript compiles clean (npx tsc --noEmit)
- [ ] Generate and run initial migration
- [ ] Create partial unique index migration for visits
