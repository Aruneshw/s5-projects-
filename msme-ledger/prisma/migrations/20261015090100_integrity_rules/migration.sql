-- =============================================================================
-- 20261015090100_integrity_rules
-- Business rules that Prisma's schema language cannot express:
--   1. CHECK constraints (non-negative money, arithmetic identities, bounds)
--   2. Partial unique indexes (no double financing, one opening entry per store)
--   3. Audit triggers (who changed what, old/new JSONB)
--   4. Immutability triggers (ledger, posted bills, payments, financing terms)
--
-- HOW THE ACTOR REACHES THE TRIGGERS (trusted path):
--   The application server, and only the server, opens every financial
--   transaction with:   SELECT set_config('app.actor_id', '<user uuid>', true),
--                              set_config('app.org_id',   '<org uuid>',  true);
--   The third argument "true" makes the setting LOCAL to the transaction, so it
--   can never leak to another request on a pooled connection. Browsers never
--   talk to PostgreSQL directly, so a client cannot forge these values.
--   Financial tables REFUSE writes when app.actor_id is not set.
--
-- Never edit this file after it has been applied anywhere. Add a new migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "items" ADD CONSTRAINT "items_coolie_nonneg" CHECK ("cooliePerBag" >= 0);
ALTER TABLE "bill_sequences" ADD CONSTRAINT "bill_sequences_positive" CHECK ("nextNumber" >= 1);

ALTER TABLE "bills"
  ADD CONSTRAINT "bills_amounts_nonneg" CHECK (
    "todayBill" >= 0 AND "coolieTotal" >= 0 AND "lessAmount" >= 0 AND "bonusAmount" >= 0
    AND "commissionAmount" >= 0 AND "amountSettled" >= 0),
  ADD CONSTRAINT "bills_commission_pct" CHECK ("commissionPercent" >= 0 AND "commissionPercent" <= 100),
  ADD CONSTRAINT "bills_no_coolie_on_purchase" CHECK ("type" <> 'PURCHASE' OR "coolieTotal" = 0),
  ADD CONSTRAINT "bills_total_identity" CHECK ("total" = "coolieTotal" + "todayBill" + "previousBalance"),
  ADD CONSTRAINT "bills_balance_identity" CHECK (
    "totalBalance" = "total" - "lessAmount" + "bonusAmount"
      + (CASE WHEN "type" = 'SALES' THEN "commissionAmount" ELSE -"commissionAmount" END)
      - "amountSettled"),
  ADD CONSTRAINT "bills_less_reason" CHECK ("lessAmount" = 0 OR length(btrim(coalesce("lessReason", ''))) > 0),
  ADD CONSTRAINT "bills_bonus_reason" CHECK ("bonusAmount" = 0 OR length(btrim(coalesce("bonusReason", ''))) > 0),
  ADD CONSTRAINT "bills_posted_numbered" CHECK ("status" = 'DRAFT' OR "billNumber" IS NOT NULL),
  ADD CONSTRAINT "bills_number_positive" CHECK ("billNumber" IS NULL OR "billNumber" > 0),
  ADD CONSTRAINT "bills_cancel_reason" CHECK ("status" <> 'CANCELLED' OR length(btrim(coalesce("cancelReason", ''))) > 0);

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_values" CHECK ("bagCount" >= 0 AND "quantity" > 0 AND "rate" >= 0
    AND "amount" >= 0 AND "coolieRate" >= 0 AND "coolieAmount" >= 0),
  ADD CONSTRAINT "bill_lines_amount_identity" CHECK ("amount" = round("quantity" * "rate", 2)),
  ADD CONSTRAINT "bill_lines_coolie_identity" CHECK ("coolieAmount" = round("coolieRate" * "bagCount", 2)),
  ADD CONSTRAINT "bill_lines_line_no" CHECK ("lineNo" >= 1);

ALTER TABLE "bag_weights" ADD CONSTRAINT "bag_weights_positive" CHECK ("weightKg" > 0 AND "seq" >= 1);
ALTER TABLE "purchase_sale_links" ADD CONSTRAINT "links_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_cancel_reason" CHECK ("status" <> 'CANCELLED' OR length(btrim(coalesce("cancelReason", ''))) > 0);
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "adjustments_nonzero" CHECK ("amount" <> 0 AND length(btrim("reason")) > 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "movements_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "worker_salaries" ADD CONSTRAINT "salaries_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "financial_years" ADD CONSTRAINT "fy_dates" CHECK ("endDate" > "startDate");

ALTER TABLE "discount_requests"
  ADD CONSTRAINT "dr_tenure_bounds" CHECK ("tenureDays" BETWEEN 1 AND 180),
  ADD CONSTRAINT "dr_amounts" CHECK ("invoiceAmount" > 0 AND "discountFee" >= 0
    AND "reserveHoldback" >= 0 AND "upfrontPayout" > 0),
  ADD CONSTRAINT "dr_parts_sum" CHECK ("upfrontPayout" + "reserveHoldback" + "discountFee" = "invoiceAmount"),
  ADD CONSTRAINT "dr_rate_bounds" CHECK ("annualRatePercent" > 0 AND "annualRatePercent" <= 100),
  ADD CONSTRAINT "dr_trust_bounds" CHECK ("trustScoreAtRequest" BETWEEN 300 AND 900),
  -- "discounted_amount <= original_amount"
  ADD CONSTRAINT "dr_funded_le_invoice" CHECK ("fundedAmount" IS NULL OR ("fundedAmount" > 0 AND "fundedAmount" <= "invoiceAmount"));

ALTER TABLE "discount_bids" ADD CONSTRAINT "bids_values" CHECK ("annualRatePercent" > 0 AND "annualRatePercent" <= 100 AND "advanceAmount" > 0);
ALTER TABLE "financing_settlements" ADD CONSTRAINT "settlement_values" CHECK ("amount" > 0 AND "reserveReleased" >= 0);
ALTER TABLE "trust_score_snapshots" ADD CONSTRAINT "tss_bounds" CHECK ("score" BETWEEN 300 AND 900 AND "baseScore" BETWEEN 300 AND 900);
ALTER TABLE "credit_profile_snapshots" ADD CONSTRAINT "cps_bounds" CHECK ("trustScore" BETWEEN 300 AND 900);
ALTER TABLE "trust_score_adjustments" ADD CONSTRAINT "tsa_nonzero" CHECK ("points" <> 0);
ALTER TABLE "loan_products" ADD CONSTRAINT "lp_values" CHECK ("minTrustScore" BETWEEN 300 AND 900
  AND "maxInterestRatePercent" > 0 AND "maxInterestRatePercent" <= 100 AND "maxLoanAmount" > 0 AND "minAnnualTurnover" >= 0);
ALTER TABLE "loan_offers" ADD CONSTRAINT "lo_values" CHECK ("indicativeAmount" > 0 AND "indicativeRatePercent" > 0);

-- ---------------------------------------------------------------------------
-- 2. Partial unique indexes
-- ---------------------------------------------------------------------------
-- An invoice can have at most ONE live financing request (prevents double financing).
CREATE UNIQUE INDEX "discount_requests_one_active_per_bill"
  ON "discount_requests" ("billId")
  WHERE "status" IN ('LISTED', 'BID_ACCEPTED', 'FUNDED', 'DEFAULTED');

-- At most one accepted bid per request.
CREATE UNIQUE INDEX "discount_bids_one_accepted"
  ON "discount_bids" ("discountRequestId") WHERE "status" = 'ACCEPTED';

-- Exactly zero or one OPENING ledger entry per store: carry-forward never duplicates it.
CREATE UNIQUE INDEX "ledger_one_opening_per_store"
  ON "ledger_entries" ("storeId") WHERE "entryType" = 'OPENING';

-- ---------------------------------------------------------------------------
-- 3. Audit infrastructure
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_actor() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_require_actor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_actor() IS NULL THEN
    RAISE EXCEPTION 'Financial write on % requires app.actor_id (use the server transaction helper)', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION app_audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  rec   jsonb := COALESCE(new_j, old_j);
BEGIN
  -- Never copy secrets into the audit trail.
  IF TG_TABLE_NAME = 'store_bank_details' THEN
    old_j := old_j - 'accountNumber';
    new_j := new_j - 'accountNumber';
  END IF;
  IF TG_TABLE_NAME = 'ocr_uploads' THEN
    old_j := old_j - 'fileData';
    new_j := new_j - 'fileData';
  END IF;

  INSERT INTO "audit_logs" ("orgId", "actorId", "action", "entityType", "entityId", "oldData", "newData", "source", "createdAt")
  VALUES (
    COALESCE(nullif(rec ->> 'orgId', '')::uuid, nullif(current_setting('app.org_id', true), '')::uuid),
    app_current_actor(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(rec ->> 'id', ''),
    old_j,
    new_j,
    'DB_TRIGGER',
    now()
  );
  RETURN NULL; -- AFTER trigger
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bills', 'bill_lines', 'bag_weights', 'ledger_entries', 'payments', 'bill_adjustments',
    'stores', 'store_bank_details', 'items', 'inventory_movements', 'purchase_sale_links',
    'expenses', 'worker_salaries', 'workers', 'payment_modes', 'memberships', 'organizations',
    'discount_requests', 'discount_bids', 'financing_settlements', 'default_events',
    'trust_score_adjustments', 'financial_years', 'ocr_uploads'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_audit_row()',
                   t || '_audit', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'bills', 'bill_lines', 'bag_weights', 'ledger_entries', 'payments', 'bill_adjustments',
    'inventory_movements', 'purchase_sale_links', 'expenses', 'worker_salaries',
    'discount_requests', 'financing_settlements'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_require_actor()',
                   t || '_require_actor', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this record is append-only (post a reversal instead)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "audit_logs_immutable" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION app_forbid_change();
CREATE TRIGGER "ledger_entries_immutable" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION app_forbid_change();
CREATE TRIGGER "inventory_movements_immutable" BEFORE UPDATE OR DELETE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION app_forbid_change();
CREATE TRIGGER "bill_adjustments_immutable" BEFORE UPDATE OR DELETE ON "bill_adjustments" FOR EACH ROW EXECUTE FUNCTION app_forbid_change();
CREATE TRIGGER "financing_settlements_immutable" BEFORE UPDATE OR DELETE ON "financing_settlements" FOR EACH ROW EXECUTE FUNCTION app_forbid_change();

-- Bills: drafts are freely editable; posted bills may only move to CANCELLED.
CREATE OR REPLACE FUNCTION app_guard_bills() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['status', 'cancelledAt', 'cancelledById', 'cancelReason',
                          'lastEditedById', 'version', 'updatedAt', 'notes'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted or cancelled bills cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled bills are read-only' USING ERRCODE = 'P0001';
  END IF;

  -- OLD.status = 'POSTED'
  IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
    RAISE EXCEPTION 'Financial fields of a posted bill are frozen; use an adjustment or cancel the bill' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" NOT IN ('POSTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid bill status transition POSTED -> %', NEW."status" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'CANCELLED' AND EXISTS (
       SELECT 1 FROM "discount_requests" d
       WHERE d."billId" = NEW."id" AND d."status" IN ('LISTED', 'BID_ACCEPTED', 'FUNDED', 'DEFAULTED')) THEN
    RAISE EXCEPTION 'Bill is under an active financing request and cannot be cancelled' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "bills_guard" BEFORE UPDATE OR DELETE ON "bills" FOR EACH ROW EXECUTE FUNCTION app_guard_bills();

-- Bill lines & bag weights can only change while the parent bill is a DRAFT.
CREATE OR REPLACE FUNCTION app_guard_bill_children() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bill_status "BillStatus";
  rec record := COALESCE(NEW, OLD);
BEGIN
  IF TG_TABLE_NAME = 'bill_lines' THEN
    SELECT b."status" INTO bill_status FROM "bills" b WHERE b."id" = rec."billId";
  ELSIF TG_TABLE_NAME = 'purchase_sale_links' THEN
    -- A link belongs to the SALES line; it is frozen once that sales bill is posted.
    SELECT b."status" INTO bill_status
      FROM "bill_lines" l JOIN "bills" b ON b."id" = l."billId" WHERE l."id" = rec."salesLineId";
  ELSE
    SELECT b."status" INTO bill_status
      FROM "bill_lines" l JOIN "bills" b ON b."id" = l."billId" WHERE l."id" = rec."billLineId";
  END IF;
  IF bill_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '% of a posted bill cannot be %', TG_TABLE_NAME, lower(TG_OP) || 'd' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "bill_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "bill_lines" FOR EACH ROW EXECUTE FUNCTION app_guard_bill_children();
CREATE TRIGGER "bag_weights_guard" BEFORE INSERT OR UPDATE OR DELETE ON "bag_weights" FOR EACH ROW EXECUTE FUNCTION app_guard_bill_children();
CREATE TRIGGER "purchase_sale_links_guard" BEFORE INSERT OR UPDATE OR DELETE ON "purchase_sale_links" FOR EACH ROW EXECUTE FUNCTION app_guard_bill_children();

-- Payments, expenses, salaries: never deleted; only ACTIVE -> CANCELLED.
CREATE OR REPLACE FUNCTION app_guard_cancellable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['status', 'cancelledAt', 'cancelledById', 'cancelReason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted; cancel instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled % rows are read-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
    RAISE EXCEPTION 'Only cancellation is allowed on %', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payments_guard" BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION app_guard_cancellable();
CREATE TRIGGER "expenses_guard" BEFORE UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION app_guard_cancellable();
CREATE TRIGGER "worker_salaries_guard" BEFORE UPDATE OR DELETE ON "worker_salaries" FOR EACH ROW EXECUTE FUNCTION app_guard_cancellable();

-- Stores: opening balance is write-once; stores are deactivated, never deleted.
CREATE OR REPLACE FUNCTION app_guard_stores() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Stores are never deleted; deactivate instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."openingBalance" IS DISTINCT FROM OLD."openingBalance" OR NEW."orgId" <> OLD."orgId" OR NEW."type" <> OLD."type" THEN
    RAISE EXCEPTION 'Opening balance, organisation and store type are write-once; use an audited adjustment' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stores_guard" BEFORE UPDATE OR DELETE ON "stores" FOR EACH ROW EXECUTE FUNCTION app_guard_stores();

-- Discount requests: financial terms are frozen at submission; status follows a state machine.
CREATE OR REPLACE FUNCTION app_guard_discount_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  frozen text[] := ARRAY['orgId', 'billId', 'invoiceAmount', 'tenureDays', 'annualRatePercent', 'discountFee',
                         'reserveHoldback', 'upfrontPayout', 'trustScoreAtRequest', 'dueDate',
                         'acceptedTermsAt', 'acceptedById', 'createdAt'];
  k text;
  ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Discount requests are never deleted' USING ERRCODE = 'P0001';
  END IF;
  FOREACH k IN ARRAY frozen LOOP
    IF (to_jsonb(OLD) -> k) IS DISTINCT FROM (to_jsonb(NEW) -> k) THEN
      RAISE EXCEPTION 'Financing term % is frozen after submission', k USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NEW."status" <> OLD."status" THEN
    ok := (OLD."status", NEW."status") IN (
      ('LISTED', 'BID_ACCEPTED'), ('LISTED', 'WITHDRAWN'),
      ('BID_ACCEPTED', 'FUNDED'), ('BID_ACCEPTED', 'WITHDRAWN'), ('BID_ACCEPTED', 'LISTED'),
      ('FUNDED', 'SETTLED'), ('FUNDED', 'DEFAULTED'),
      ('DEFAULTED', 'SETTLED'));
    IF NOT ok THEN
      RAISE EXCEPTION 'Invalid financing status transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "discount_requests_guard" BEFORE UPDATE OR DELETE ON "discount_requests" FOR EACH ROW EXECUTE FUNCTION app_guard_discount_requests();

-- Trust adjustments: only the revoke fields may change; never deleted.
CREATE OR REPLACE FUNCTION app_guard_trust_adjustments() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed text[] := ARRAY['revokedAt', 'revokedById'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Trust score adjustments are never deleted; revoke instead' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
    RAISE EXCEPTION 'Only revocation is allowed on trust score adjustments' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "trust_adjustments_guard" BEFORE UPDATE OR DELETE ON "trust_score_adjustments" FOR EACH ROW EXECUTE FUNCTION app_guard_trust_adjustments();
