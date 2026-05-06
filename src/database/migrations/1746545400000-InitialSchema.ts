import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1746545400000 implements MigrationInterface {
  name = 'InitialSchema1746545400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "role_enum" AS ENUM ('user', 'admin')
    `);
    await queryRunner.query(`
      CREATE TYPE "campaign_status_enum" AS ENUM (
        'pending_review', 'active', 'paused', 'completed', 'rejected'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "campaign_type_enum" AS ENUM ('blog', 'youtube')
    `);
    await queryRunner.query(`
      CREATE TYPE "pricing_tier_enum" AS ENUM ('economy', 'standard', 'premium')
    `);
    await queryRunner.query(`
      CREATE TYPE "visit_status_enum" AS ENUM ('in_progress', 'completed', 'abandoned')
    `);
    await queryRunner.query(`
      CREATE TYPE "transaction_type_enum" AS ENUM (
        'deposit', 'withdrawal', 'earning', 'referral_bonus', 'campaign_escrow'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "transaction_status_enum" AS ENUM ('pending', 'successful', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE "withdrawal_status_enum" AS ENUM ('processing', 'completed', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_method_enum" AS ENUM ('card', 'bank_transfer')
    `);

    // ── Users ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
        "googleId"        varchar NOT NULL,
        "email"           varchar NOT NULL,
        "fullName"        varchar NOT NULL,
        "avatarUrl"       varchar,
        "phone"           varchar,
        "referralCode"    varchar NOT NULL,
        "referredById"    varchar,
        "isDeposited"     boolean NOT NULL DEFAULT false,
        "isBlocked"       boolean NOT NULL DEFAULT false,
        "blockedReason"   varchar,
        "blockedAt"       timestamp,
        "role"            "role_enum" NOT NULL DEFAULT 'user',
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        "updatedAt"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_googleId" UNIQUE ("googleId"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_referralCode" UNIQUE ("referralCode")
      )
    `);

    // ── Refresh Tokens ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"      uuid NOT NULL,
        "tokenHash"   varchar NOT NULL,
        "expiresAt"   timestamp NOT NULL,
        "isRevoked"   boolean NOT NULL DEFAULT false,
        "createdAt"   timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_tokenHash" ON "refresh_tokens" ("tokenHash")
    `);

    // ── Wallets ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"          uuid NOT NULL,
        "balance"         bigint NOT NULL DEFAULT 0,
        "totalEarned"     bigint NOT NULL DEFAULT 0,
        "totalWithdrawn"  bigint NOT NULL DEFAULT 0,
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        "updatedAt"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_wallets_userId" UNIQUE ("userId"),
        CONSTRAINT "FK_wallets_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // ── Campaigns ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "campaigns" (
        "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
        "advertiserId"    uuid NOT NULL,
        "name"            varchar NOT NULL,
        "url"             varchar NOT NULL,
        "description"     text NOT NULL,
        "campaignType"    "campaign_type_enum" NOT NULL,
        "pricingTier"     "pricing_tier_enum" NOT NULL,
        "payPerVisit"     bigint NOT NULL,
        "minDuration"     int NOT NULL,
        "totalVisits"     int NOT NULL,
        "completedVisits" int NOT NULL DEFAULT 0,
        "budget"          bigint NOT NULL,
        "spent"           bigint NOT NULL DEFAULT 0,
        "icon"            varchar,
        "bgColor"         varchar,
        "fgColor"         varchar,
        "badge"           varchar,
        "badgeLabel"      varchar,
        "status"          "campaign_status_enum" NOT NULL DEFAULT 'pending_review',
        "reviewedById"    uuid,
        "reviewedAt"      timestamp,
        "rejectionReason" varchar,
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        "updatedAt"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_campaigns_advertiserId"
          FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_campaigns_reviewedById"
          FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_campaigns_advertiserId" ON "campaigns" ("advertiserId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_campaigns_status" ON "campaigns" ("status")
    `);

    // ── Visits ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "visits" (
        "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"          uuid NOT NULL,
        "campaignId"      uuid NOT NULL,
        "serverStartTime" timestamp NOT NULL,
        "serverEndTime"   timestamp,
        "clientDuration"  int,
        "earned"          bigint,
        "status"          "visit_status_enum" NOT NULL DEFAULT 'in_progress',
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visits" PRIMARY KEY ("id"),
        CONSTRAINT "FK_visits_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_visits_campaignId"
          FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_visits_userId_campaignId" ON "visits" ("userId", "campaignId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_visits_status" ON "visits" ("status")
    `);
    // One completed visit per user per campaign (fraud prevention)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_visits_userId_campaignId_completed"
        ON "visits" ("userId", "campaignId")
        WHERE "status" = 'completed'
    `);

    // ── Transactions ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id"                  uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"              uuid NOT NULL,
        "walletId"            uuid NOT NULL,
        "type"                "transaction_type_enum" NOT NULL,
        "amount"              bigint NOT NULL,
        "description"         varchar NOT NULL,
        "status"              "transaction_status_enum" NOT NULL DEFAULT 'pending',
        "paystackReference"   varchar,
        "metadata"            jsonb,
        "createdAt"           timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_transactions_paystackReference" UNIQUE ("paystackReference"),
        CONSTRAINT "FK_transactions_walletId"
          FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transactions_userId" ON "transactions" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transactions_walletId" ON "transactions" ("walletId")
    `);

    // ── Bank Accounts ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "bank_accounts" (
        "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"          uuid NOT NULL,
        "bankCode"        varchar NOT NULL,
        "bankName"        varchar NOT NULL,
        "accountNumber"   varchar NOT NULL,
        "accountName"     varchar NOT NULL,
        "isDefault"       boolean NOT NULL DEFAULT false,
        "createdAt"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bank_accounts_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_bank_accounts_userId" ON "bank_accounts" ("userId")
    `);

    // ── Withdrawals ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "withdrawals" (
        "id"                    uuid DEFAULT gen_random_uuid() NOT NULL,
        "userId"                uuid NOT NULL,
        "bankAccountId"         uuid NOT NULL,
        "transactionId"         uuid,
        "amount"                bigint NOT NULL,
        "status"                "withdrawal_status_enum" NOT NULL DEFAULT 'processing',
        "paystackTransferCode"  varchar,
        "processedById"         uuid,
        "processedAt"           timestamp,
        "failureReason"         varchar,
        "createdAt"             timestamp NOT NULL DEFAULT now(),
        "updatedAt"             timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_withdrawals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_withdrawals_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_withdrawals_bankAccountId"
          FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_withdrawals_transactionId"
          FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_withdrawals_processedById"
          FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_withdrawals_userId" ON "withdrawals" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_withdrawals_status" ON "withdrawals" ("status")
    `);

    // ── Referrals ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "referrals" (
        "id"                    uuid DEFAULT gen_random_uuid() NOT NULL,
        "referrerId"            uuid NOT NULL,
        "refereeId"             uuid NOT NULL,
        "milestone1Credited"    boolean NOT NULL DEFAULT false,
        "milestone1CreditedAt"  timestamp,
        "milestone2Credited"    boolean NOT NULL DEFAULT false,
        "milestone2CreditedAt"  timestamp,
        "totalEarned"           bigint NOT NULL DEFAULT 0,
        "createdAt"             timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referrals_refereeId" UNIQUE ("refereeId"),
        CONSTRAINT "FK_referrals_referrerId"
          FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_referrals_refereeId"
          FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_referrals_referrerId" ON "referrals" ("referrerId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "referrals" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "withdrawals" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_accounts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "visits" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaigns" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "withdrawal_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transaction_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transaction_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "visit_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pricing_tier_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "campaign_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "campaign_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "role_enum"`);
  }
}
