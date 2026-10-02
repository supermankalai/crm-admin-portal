-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "description" TEXT;

-- Existing membership invoices get their plan name as description.
UPDATE "Invoice" i SET description = p.name || ' membership'
  FROM "Membership" s JOIN "MembershipPlan" p ON p.id = s."planId"
 WHERE s.id = i."membershipId" AND i.description IS NULL;

-- ───────────────────── Refunds can never exceed the payment ─────────────────────
-- The app checks this under a row lock; the trigger guarantees it for every writer
-- (including concurrent refunds and the owner role) and keeps Payment.status in sync.
CREATE FUNCTION enforce_refund_total() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_amount integer;
  v_status text;
  v_refunded integer;
BEGIN
  SELECT "amountMinor", status::text INTO v_amount, v_status
    FROM "Payment" WHERE id = NEW."paymentId" AND "gymId" = NEW."gymId" FOR UPDATE;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'refund:payment_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'VOID' THEN
    RAISE EXCEPTION 'refund:payment_void' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum("amountMinor"), 0) INTO v_refunded FROM "Refund" WHERE "paymentId" = NEW."paymentId";
  IF v_refunded + NEW."amountMinor" > v_amount THEN
    RAISE EXCEPTION 'refund:exceeds_payment' USING ERRCODE = 'P0001',
      DETAIL = format('refundable=%s', v_amount - v_refunded);
  END IF;
  UPDATE "Payment"
     SET status = CASE WHEN v_refunded + NEW."amountMinor" = v_amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END::"PaymentStatus",
         "updatedAt" = now()
   WHERE id = NEW."paymentId";
  RETURN NEW;
END $$;

CREATE TRIGGER "Refund_total_guard" BEFORE INSERT ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION enforce_refund_total();

-- Refunds are immutable once recorded (corrections are made with a new entry).
REVOKE ALL ON FUNCTION enforce_refund_total() FROM PUBLIC;
