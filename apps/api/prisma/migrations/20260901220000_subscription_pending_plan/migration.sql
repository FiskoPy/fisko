-- A checkout used to overwrite an ACTIVE subscription to 'pending', dropping a
-- paying user to the free plan until the new webhook landed; and the webhook's
-- repeat guard keyed on status, so a paid upgrade was ignored as a "repeat".
ALTER TABLE "Subscription" ADD COLUMN "pendingPlanId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "paidHashPedido" TEXT;
