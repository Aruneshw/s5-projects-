// src/lib/validation/schemas.ts
// Request schemas shared by Route Handlers (authoritative validation) and forms (early feedback).
import { z } from "zod";
import { isoDate, moneyStr, optionalText, percentStr, qtyStr, shortText, signedMoneyStr, uuid } from "./common";

// ------------------------------ Stores -------------------------------------
export const StoreCreateSchema = z.object({
  type: z.enum(["SUPPLIER", "CUSTOMER"]),
  shopName: shortText(120).min(1, "Shop name is required"),
  city: shortText(80).min(1, "City is required"),
  location: optionalText(120),
  ownerName: optionalText(80),
  coOwnerName: optionalText(80),
  contactName: optionalText(80),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "Enter a valid phone number")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  address: optionalText(300),
  upiId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, "Enter a valid UPI ID")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  storeMark: optionalText(30),
  /** Accepted ONLY on creation. Positive = they owe us (customer) / we owe them (supplier). */
  openingBalance: signedMoneyStr.default("0"),
});
export type StoreCreateInput = z.infer<typeof StoreCreateSchema>;

// Opening balance is deliberately absent: it cannot be edited.
export const StoreUpdateSchema = StoreCreateSchema.omit({ type: true, openingBalance: true })
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().positive() });

export const StoreBankSchema = z.object({
  accountName: shortText(120).min(1),
  accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, "Account number must be 6–20 digits"),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code"),
  bankName: optionalText(120),
});

export const BalanceAdjustmentSchema = z.object({
  type: z.enum(["OPENING_BALANCE_CORRECTION", "BALANCE_CORRECTION"]),
  amount: signedMoneyStr.refine((v) => Number(v) !== 0, "Adjustment cannot be zero"),
  reason: shortText(300).min(5, "Give a clear reason (at least 5 characters)"),
  entryDate: isoDate,
});

// ------------------------------- Items -------------------------------------
export const ItemCreateSchema = z.object({
  name: shortText(80).min(1, "Item name is required"),
  unitType: z.enum(["KG", "BAG", "BOX"]),
  cooliePerBag: moneyStr.default("0"),
});
export const ItemUpdateSchema = z.object({
  name: shortText(80).min(1).optional(),
  cooliePerBag: moneyStr.optional(),
  isActive: z.boolean().optional(),
});

// ------------------------------- Bills -------------------------------------
export const BillLineInputSchema = z.object({
  itemId: uuid,
  entryMode: z.enum(["WEIGHED", "COUNT", "COMBINED_LOT"]),
  lineMark: optionalText(30),
  weights: z.array(qtyStr).max(500).optional(),
  quantity: qtyStr.optional(),
  bagCount: z.number().int().min(0).max(100_000).optional(),
  rate: moneyStr,
  sourcePurchaseLineId: uuid.optional().nullable(),
  /** Owner-only: accept a sale above the linked batch's remaining quantity (flagged for reconciliation). */
  allowOversell: z.boolean().optional(),
});
export type BillLineInput = z.infer<typeof BillLineInputSchema>;

export const BillInputSchema = z.object({
  /** Optional client-generated UUID (offline creation); the server keeps it so retries are idempotent. */
  id: uuid.optional(),
  type: z.enum(["PURCHASE", "SALES"]),
  storeId: uuid,
  billDate: isoDate,
  dueDate: isoDate.optional().nullable(),
  lines: z.array(BillLineInputSchema).min(1, "Add at least one item").max(200),
  lessAmount: moneyStr.default("0"),
  lessReason: optionalText(200),
  bonusAmount: moneyStr.default("0"),
  bonusReason: optionalText(200),
  commissionPercent: percentStr.default("0"),
  amountSettled: moneyStr.default("0"),
  settlementModeId: uuid.optional().nullable(),
  notes: optionalText(500),
  /** true = post now (numbered, hits ledger & stock). false = save as editable draft. */
  post: z.boolean().default(true),
  /** What the device showed as previous balance — used to flag offline drift, never trusted. */
  clientPreviousBalance: signedMoneyStr.optional(),
});
export type BillInput = z.infer<typeof BillInputSchema>;

export const BillDraftUpdateSchema = BillInputSchema.omit({ id: true, type: true }).extend({
  version: z.number().int().positive(),
});

export const BillCancelSchema = z.object({
  reason: shortText(300).min(5, "Give a clear reason (at least 5 characters)"),
  version: z.number().int().positive(),
});

export const BillAdjustmentSchema = z.object({
  type: z.enum(["COOLIE_CORRECTION", "LESS", "BONUS"]),
  /** COOLIE_CORRECTION: signed delta. LESS / BONUS: positive amount. */
  amount: signedMoneyStr.refine((v) => Number(v) !== 0, "Amount cannot be zero"),
  reason: shortText(300).min(5, "Give a clear reason (at least 5 characters)"),
  entryDate: isoDate,
});

// ------------------------------ Payments -----------------------------------
export const PaymentInputSchema = z.object({
  storeId: uuid,
  billId: uuid.optional().nullable(),
  paymentModeId: uuid,
  amount: moneyStr.refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  paymentDate: isoDate,
  reference: optionalText(100),
  notes: optionalText(300),
  /** Client-generated; resubmitting the same key never creates a second payment. */
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const CancelSchema = z.object({ reason: shortText(300).min(5, "Give a clear reason (at least 5 characters)") });

// ------------------------------ Expenses -----------------------------------
export const ExpenseInputSchema = z.object({
  expenseDate: isoDate,
  category: z.enum(["TRANSPORT", "LORRY_HIRE", "FUEL", "TOLLS", "MARKET_FEES", "MISCELLANEOUS"]),
  amount: moneyStr.refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  notes: optionalText(300),
  paymentModeId: uuid.optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const WorkerInputSchema = z.object({
  name: shortText(80).min(1),
  phone: optionalText(20),
});

export const SalaryInputSchema = z.object({
  workerId: uuid,
  paymentDate: isoDate,
  periodFrom: isoDate.optional().nullable(),
  periodTo: isoDate.optional().nullable(),
  amount: moneyStr.refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  paymentModeId: uuid.optional().nullable(),
  notes: optionalText(300),
  idempotencyKey: z.string().trim().min(8).max(100),
});

// ----------------------------- Inventory -----------------------------------
export const StockAdjustmentSchema = z.object({
  itemId: uuid,
  quantity: signedMoneyStr.pipe(z.string().regex(/^-?\d{1,9}(\.\d{1,3})?$/)).refine((v) => Number(v) !== 0, "Cannot be zero"),
  bagCount: z.number().int().default(0),
  movementDate: isoDate,
  reason: shortText(300).min(5, "Give a clear reason (at least 5 characters)"),
});

// ------------------------------- Team --------------------------------------
export const PasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/[0-9]/, "Include a number");

export const MemberCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "3–32 characters: letters, numbers, dot, dash, underscore"),
  displayName: shortText(80).min(1),
  password: PasswordSchema,
  role: z.enum(["MSME_OWNER", "STAFF_CASHIER"]),
});

export const MemberUpdateSchema = z.object({
  role: z.enum(["MSME_OWNER", "STAFF_CASHIER"]).optional(),
  isActive: z.boolean().optional(),
});

export const ResetRequestSchema = z.object({ username: z.string().trim().toLowerCase().min(3).max(32) });
export const ResetConfirmSchema = z.object({ token: z.string().min(20).max(200), password: PasswordSchema });
export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: PasswordSchema });

// ---------------------------- Discounting ----------------------------------
export const DiscountAcceptSchema = z.object({
  billId: uuid,
  /** The client must echo the exact quote it displayed; the server recomputes and compares. */
  expectedUpfrontPayout: moneyStr,
  acceptTerms: z.literal(true, { message: "You must explicitly accept the terms" }),
  settlementRouting: z.enum(["TO_BUSINESS", "TO_FINANCIER"]).default("TO_FINANCIER"),
});

export const BidSchema = z.object({
  annualRatePercent: percentStr.refine((v) => Number(v) > 0 && Number(v) <= 100, "Rate must be between 0 and 100"),
  advanceAmount: moneyStr.refine((v) => Number(v) > 0, "Advance must be greater than 0"),
});

export const FundSchema = z.object({
  fundedAmount: moneyStr,
  fundingReference: shortText(100).min(3),
});

export const SettlementSchema = z.object({
  amount: moneyStr.refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  routing: z.enum(["TO_BUSINESS", "TO_FINANCIER"]),
  settledOn: isoDate,
  reserveReleased: moneyStr.default("0"),
  reference: optionalText(100),
});
