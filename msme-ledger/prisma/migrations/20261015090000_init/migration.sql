-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('MSME', 'FINANCIER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MSME_OWNER', 'STAFF_CASHIER', 'INVESTOR', 'LENDER_BANK');

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('SUPPLIER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('KG', 'BAG', 'BOX');

-- CreateEnum
CREATE TYPE "BillType" AS ENUM ('PURCHASE', 'SALES');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillSource" AS ENUM ('MANUAL', 'OFFLINE_SYNC', 'OCR');

-- CreateEnum
CREATE TYPE "EntryMode" AS ENUM ('WEIGHED', 'COUNT', 'COMBINED_LOT');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING', 'BILL_CHARGE', 'COOLIE', 'LESS', 'BONUS', 'COMMISSION', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('COOLIE_CORRECTION', 'LESS', 'BONUS', 'OPENING_BALANCE_CORRECTION', 'BALANCE_CORRECTION');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE', 'SALE', 'CANCEL_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('TRANSPORT', 'LORRY_HIRE', 'FUEL', 'TOLLS', 'MARKET_FEES', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('LISTED', 'BID_ACCEPTED', 'FUNDED', 'SETTLED', 'DEFAULTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SettlementRouting" AS ENUM ('TO_BUSINESS', 'TO_FINANCIER');

-- CreateEnum
CREATE TYPE "RiskFlag" AS ENUM ('NORMAL', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('APPLIED', 'CONFLICT', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('UPLOADED', 'EXTRACTED', 'FAILED', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "LoanOfferStatus" AS ENUM ('INDICATIVE', 'INTEREST_EXPRESSED', 'WITHDRAWN', 'LENDER_DECLINED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'MSME',
    "riskFlag" "RiskFlag" NOT NULL DEFAULT 'NORMAL',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "shareCreditProfile" BOOLEAN NOT NULL DEFAULT false,
    "lendingPartnerId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "type" "StoreType" NOT NULL,
    "shopName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "location" TEXT,
    "ownerName" TEXT,
    "coOwnerName" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "upiId" TEXT,
    "storeMark" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_bank_details" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "store_bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" "UnitType" NOT NULL,
    "cooliePerBag" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_modes" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDigital" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_sequences" (
    "orgId" UUID NOT NULL,
    "billType" "BillType" NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bill_sequences_pkey" PRIMARY KEY ("orgId","billType")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "type" "BillType" NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "BillSource" NOT NULL DEFAULT 'MANUAL',
    "billNumber" INTEGER,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "storeId" UUID NOT NULL,
    "previousBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "todayBill" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "coolieTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lessAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lessReason" TEXT,
    "bonusAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonusReason" TEXT,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountSettled" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "lastEditedById" UUID NOT NULL,
    "postedAt" TIMESTAMPTZ(6),
    "postedById" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_lines" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "entryMode" "EntryMode" NOT NULL,
    "lineMark" TEXT,
    "bagCount" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "coolieRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "coolieAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bag_weights" (
    "id" UUID NOT NULL,
    "billLineId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "weightKg" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "bag_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_sale_links" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "salesLineId" UUID NOT NULL,
    "purchaseLineId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "oversold" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_sale_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "billId" UUID,
    "direction" "PaymentDirection" NOT NULL,
    "paymentModeId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_adjustments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "billId" UUID,
    "storeId" UUID NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "orgId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "billId" UUID,
    "paymentId" UUID,
    "adjustmentId" UUID,
    "reversesEntryId" UUID,
    "description" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "movementDate" DATE NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "bagCount" INTEGER NOT NULL DEFAULT 0,
    "billLineId" UUID,
    "reversesMovementId" UUID,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "paymentModeId" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_salaries" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "paymentDate" DATE NOT NULL,
    "periodFrom" DATE,
    "periodTo" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentModeId" UUID,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMPTZ(6),
    "closedById" UUID,
    "closingSnapshot" JSONB,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "orgId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_mutations" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "result" JSONB,
    "conflictData" JSONB,
    "resolution" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_uploads" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileData" BYTEA,
    "status" "OcrStatus" NOT NULL DEFAULT 'UPLOADED',
    "rawText" TEXT,
    "candidates" JSONB,
    "error" TEXT,
    "billId" UUID,
    "retainUntil" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ocr_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_requests" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "status" "DiscountStatus" NOT NULL DEFAULT 'LISTED',
    "invoiceAmount" DECIMAL(14,2) NOT NULL,
    "tenureDays" INTEGER NOT NULL,
    "annualRatePercent" DECIMAL(5,2) NOT NULL,
    "discountFee" DECIMAL(14,2) NOT NULL,
    "reserveHoldback" DECIMAL(14,2) NOT NULL,
    "upfrontPayout" DECIMAL(14,2) NOT NULL,
    "trustScoreAtRequest" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "acceptedTermsAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedById" UUID NOT NULL,
    "financierOrgId" UUID,
    "acceptedBidId" UUID,
    "fundedAmount" DECIMAL(14,2),
    "fundedAt" TIMESTAMPTZ(6),
    "fundingReference" TEXT,
    "settlementRouting" "SettlementRouting" NOT NULL DEFAULT 'TO_FINANCIER',
    "settledAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discount_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_bids" (
    "id" UUID NOT NULL,
    "discountRequestId" UUID NOT NULL,
    "financierOrgId" UUID NOT NULL,
    "bidderUserId" UUID NOT NULL,
    "annualRatePercent" DECIMAL(5,2) NOT NULL,
    "advanceAmount" DECIMAL(14,2) NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discount_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_settlements" (
    "id" UUID NOT NULL,
    "discountRequestId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "routing" "SettlementRouting" NOT NULL,
    "settledOn" DATE NOT NULL,
    "reserveReleased" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financing_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_events" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "discountRequestId" UUID NOT NULL,
    "detectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "daysOverdue" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "default_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_adjustments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "defaultEventId" UUID,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_snapshots" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "baseScore" INTEGER NOT NULL,
    "adjustmentTotal" INTEGER NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "factors" JSONB NOT NULL,
    "explanations" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_profile_snapshots" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "metrics" JSONB NOT NULL,
    "trustScore" INTEGER NOT NULL,
    "riskFlag" "RiskFlag" NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lending_partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lending_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "id" UUID NOT NULL,
    "lendingPartnerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minTrustScore" INTEGER NOT NULL,
    "maxInterestRatePercent" DECIMAL(5,2) NOT NULL,
    "maxLoanAmount" DECIMAL(14,2) NOT NULL,
    "minAnnualTurnover" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minMonthsHistory" INTEGER NOT NULL DEFAULT 0,
    "excludeHighRisk" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_offers" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "loanProductId" UUID NOT NULL,
    "creditProfileSnapshotId" UUID NOT NULL,
    "indicativeAmount" DECIMAL(14,2) NOT NULL,
    "indicativeRatePercent" DECIMAL(5,2) NOT NULL,
    "status" "LoanOfferStatus" NOT NULL DEFAULT 'INDICATIVE',
    "lenderNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loan_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE INDEX "memberships_orgId_idx" ON "memberships"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_orgId_key" ON "memberships"("userId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "rate_limit_hits_key_createdAt_idx" ON "rate_limit_hits"("key", "createdAt");

-- CreateIndex
CREATE INDEX "stores_orgId_shopName_idx" ON "stores"("orgId", "shopName");

-- CreateIndex
CREATE UNIQUE INDEX "stores_orgId_type_shopName_city_key" ON "stores"("orgId", "type", "shopName", "city");

-- CreateIndex
CREATE UNIQUE INDEX "store_bank_details_storeId_key" ON "store_bank_details"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "items_orgId_name_key" ON "items"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workers_orgId_name_key" ON "workers"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_modes_orgId_name_key" ON "payment_modes"("orgId", "name");

-- CreateIndex
CREATE INDEX "bills_orgId_type_billDate_idx" ON "bills"("orgId", "type", "billDate");

-- CreateIndex
CREATE INDEX "bills_orgId_storeId_idx" ON "bills"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_orgId_type_billNumber_key" ON "bills"("orgId", "type", "billNumber");

-- CreateIndex
CREATE INDEX "bill_lines_orgId_itemId_idx" ON "bill_lines"("orgId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_billId_lineNo_key" ON "bill_lines"("billId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "bag_weights_billLineId_seq_key" ON "bag_weights"("billLineId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_sale_links_salesLineId_key" ON "purchase_sale_links"("salesLineId");

-- CreateIndex
CREATE INDEX "purchase_sale_links_purchaseLineId_idx" ON "purchase_sale_links"("purchaseLineId");

-- CreateIndex
CREATE INDEX "payments_orgId_storeId_paymentDate_idx" ON "payments"("orgId", "storeId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "payments_orgId_idempotencyKey_key" ON "payments"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "bill_adjustments_orgId_storeId_idx" ON "bill_adjustments"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reversesEntryId_key" ON "ledger_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "ledger_entries_orgId_storeId_seq_idx" ON "ledger_entries"("orgId", "storeId", "seq");

-- CreateIndex
CREATE INDEX "ledger_entries_orgId_entryDate_idx" ON "ledger_entries"("orgId", "entryDate");

-- CreateIndex
CREATE INDEX "ledger_entries_billId_idx" ON "ledger_entries"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_reversesMovementId_key" ON "inventory_movements"("reversesMovementId");

-- CreateIndex
CREATE INDEX "inventory_movements_orgId_itemId_movementDate_idx" ON "inventory_movements"("orgId", "itemId", "movementDate");

-- CreateIndex
CREATE INDEX "expenses_orgId_expenseDate_idx" ON "expenses"("orgId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_orgId_idempotencyKey_key" ON "expenses"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "worker_salaries_orgId_paymentDate_idx" ON "worker_salaries"("orgId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "worker_salaries_orgId_idempotencyKey_key" ON "worker_salaries"("orgId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_orgId_label_key" ON "financial_years"("orgId", "label");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_id_idx" ON "audit_logs"("orgId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "sync_mutations_orgId_status_idx" ON "sync_mutations"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_orgId_scope_key_key" ON "idempotency_records"("orgId", "scope", "key");

-- CreateIndex
CREATE INDEX "ocr_uploads_orgId_createdAt_idx" ON "ocr_uploads"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "discount_requests_orgId_status_idx" ON "discount_requests"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "discount_bids_discountRequestId_financierOrgId_key" ON "discount_bids"("discountRequestId", "financierOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "default_events_discountRequestId_key" ON "default_events"("discountRequestId");

-- CreateIndex
CREATE INDEX "default_events_orgId_idx" ON "default_events"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "trust_score_adjustments_defaultEventId_key" ON "trust_score_adjustments"("defaultEventId");

-- CreateIndex
CREATE INDEX "trust_score_adjustments_orgId_idx" ON "trust_score_adjustments"("orgId");

-- CreateIndex
CREATE INDEX "trust_score_snapshots_orgId_computedAt_idx" ON "trust_score_snapshots"("orgId", "computedAt");

-- CreateIndex
CREATE INDEX "credit_profile_snapshots_orgId_computedAt_idx" ON "credit_profile_snapshots"("orgId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lending_partners_name_key" ON "lending_partners"("name");

-- CreateIndex
CREATE UNIQUE INDEX "loan_products_lendingPartnerId_name_key" ON "loan_products"("lendingPartnerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "loan_offers_orgId_loanProductId_creditProfileSnapshotId_key" ON "loan_offers"("orgId", "loanProductId", "creditProfileSnapshotId");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_lendingPartnerId_fkey" FOREIGN KEY ("lendingPartnerId") REFERENCES "lending_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bank_details" ADD CONSTRAINT "store_bank_details_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_weights" ADD CONSTRAINT "bag_weights_billLineId_fkey" FOREIGN KEY ("billLineId") REFERENCES "bill_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_sale_links" ADD CONSTRAINT "purchase_sale_links_salesLineId_fkey" FOREIGN KEY ("salesLineId") REFERENCES "bill_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_sale_links" ADD CONSTRAINT "purchase_sale_links_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "bill_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "bill_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_billLineId_fkey" FOREIGN KEY ("billLineId") REFERENCES "bill_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversesMovementId_fkey" FOREIGN KEY ("reversesMovementId") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "payment_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_salaries" ADD CONSTRAINT "worker_salaries_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_salaries" ADD CONSTRAINT "worker_salaries_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "payment_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_bids" ADD CONSTRAINT "discount_bids_discountRequestId_fkey" FOREIGN KEY ("discountRequestId") REFERENCES "discount_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_bids" ADD CONSTRAINT "discount_bids_bidderUserId_fkey" FOREIGN KEY ("bidderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_settlements" ADD CONSTRAINT "financing_settlements_discountRequestId_fkey" FOREIGN KEY ("discountRequestId") REFERENCES "discount_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "default_events" ADD CONSTRAINT "default_events_discountRequestId_fkey" FOREIGN KEY ("discountRequestId") REFERENCES "discount_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_score_adjustments" ADD CONSTRAINT "trust_score_adjustments_defaultEventId_fkey" FOREIGN KEY ("defaultEventId") REFERENCES "default_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_lendingPartnerId_fkey" FOREIGN KEY ("lendingPartnerId") REFERENCES "lending_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_loanProductId_fkey" FOREIGN KEY ("loanProductId") REFERENCES "loan_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_creditProfileSnapshotId_fkey" FOREIGN KEY ("creditProfileSnapshotId") REFERENCES "credit_profile_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
