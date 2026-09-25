import { Router } from "express";
import express from "express";
import { requireAuth } from "../auth.js";
import { withUserScope } from "../middleware/userScope.js";
import { readUserPlan, writeUserPlan } from "../lib/userPlanStore.js";
import { dataDirFor } from "../lib/paths.js";
import { describeUsage } from "../middleware/quota.js";
import { isSuperAdmin } from "../lib/userPlan.js";

/**
 * Billing routes — Phase 3.
 *
 * - GET  /api/billing/plan      : current plan + usage snapshot
 * - GET  /api/billing/usage     : usage-only (lightweight polling)
 * - POST /api/billing/checkout  : creates a Stripe Checkout session for the
 *                                 premium price; returns the hosted URL
 * - POST /api/billing/portal    : returns a Stripe Customer Portal URL so the
 *                                 user can update card / cancel / view invoices
 *
 * Stripe webhook is mounted SEPARATELY in index.js because it needs the raw
 * body for signature verification (not JSON-parsed by express.json).
 *
 * All Stripe interaction is gated behind STRIPE_SECRET_KEY presence — without
 * keys the routes return 503 PAYMENTS_NOT_CONFIGURED so the UI can render a
 * "Payments coming soon" state instead of crashing.
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 3
 */

const router = Router();

function stripeConfigured() {
  return Boolean(
    String(process.env.STRIPE_SECRET_KEY || "").trim() &&
    String(process.env.STRIPE_PREMIUM_PRICE_ID || "").trim()
  );
}

async function getStripe() {
  // Lazy import so the server boots even without `stripe` installed yet.
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  try {
    const Stripe = (await import("stripe")).default;
    return new Stripe(key, { apiVersion: "2024-10-28.acacia" });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("Cannot find package")) {
      throw new Error("Stripe SDK not installed. Run: npm install stripe");
    }
    throw err;
  }
}

router.get("/plan", requireAuth, withUserScope, (req, res) => {
  const planRecord = readUserPlan(req.ctx.dataDir);
  res.json({
    ok: true,
    plan: req.ctx.plan,
    isSuperAdmin: req.ctx.isSuperAdmin,
    stripeConfigured: stripeConfigured(),
    record: planRecord,
    usage: describeUsage(req),
  });
});

router.get("/usage", requireAuth, withUserScope, (req, res) => {
  res.json({ ok: true, usage: describeUsage(req) });
});

router.post("/checkout", requireAuth, withUserScope, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "PAYMENTS_NOT_CONFIGURED",
      hint: "STRIPE_SECRET_KEY and STRIPE_PREMIUM_PRICE_ID must be set on the server.",
    });
  }
  if (req.ctx.isSuperAdmin) {
    return res.status(400).json({ ok: false, error: "Super-admin does not subscribe" });
  }
  try {
    const stripe = await getStripe();
    const successUrl = String(req.body?.successUrl || `${req.headers.origin || ""}/settings?upgrade=success`).trim();
    const cancelUrl  = String(req.body?.cancelUrl  || `${req.headers.origin || ""}/settings?upgrade=cancel`).trim();

    // Reuse an existing Stripe customer if we already created one — keeps
    // invoice history consistent for the same user across multiple upgrades.
    const existing = readUserPlan(req.ctx.dataDir);
    const customerArgs = existing.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : { customer_email: req.ctx.email || undefined };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        price: String(process.env.STRIPE_PREMIUM_PRICE_ID || "").trim(),
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Echo our internal user id in metadata so the webhook can map back
      // even if the customer email changes later.
      metadata: { biblefuel_user_id: req.ctx.userId },
      subscription_data: {
        metadata: { biblefuel_user_id: req.ctx.userId },
      },
      ...customerArgs,
    });

    res.json({ ok: true, url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("[BILLING] checkout error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/portal", requireAuth, withUserScope, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({ ok: false, error: "PAYMENTS_NOT_CONFIGURED" });
  }
  try {
    const record = readUserPlan(req.ctx.dataDir);
    if (!record.stripeCustomerId) {
      return res.status(400).json({ ok: false, error: "No Stripe customer for this user yet — subscribe first." });
    }
    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: record.stripeCustomerId,
      return_url: String(req.body?.returnUrl || `${req.headers.origin || ""}/settings`).trim(),
    });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[BILLING] portal error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Stripe webhook handler.
 *
 * Mount this separately in index.js with express.raw({ type: 'application/json' })
 * because Stripe needs the unparsed body bytes to verify the signature.
 */
export async function stripeWebhookHandler(req, res) {
  if (!stripeConfigured()) {
    return res.status(503).json({ ok: false, error: "PAYMENTS_NOT_CONFIGURED" });
  }
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return res.status(500).json({ ok: false, error: "STRIPE_WEBHOOK_SECRET not configured" });
  }
  try {
    const stripe = await getStripe();
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.warn("[BILLING] webhook signature failed:", err?.message || err);
      return res.status(400).json({ ok: false, error: `Webhook signature: ${err?.message || err}` });
    }

    const userIdFromEvent = (event) => {
      const obj = event?.data?.object || {};
      const meta = obj.metadata || obj.subscription_details?.metadata || {};
      return String(meta.biblefuel_user_id || "").trim();
    };

    const applyPatch = (userId, patch) => {
      if (!userId) {
        console.warn(`[BILLING] webhook ${event.type} had no biblefuel_user_id metadata; skipping`);
        return;
      }
      const dir = dataDirFor({ sub: userId, email: "" });
      writeUserPlan(dir, patch);
      console.log(`[BILLING] applied ${event.type} for user ${userId}:`, patch);
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const obj = event.data.object;
        applyPatch(userIdFromEvent(event), {
          plan: "premium",
          status: "active",
          stripeCustomerId: String(obj.customer || ""),
          stripeSubscriptionId: String(obj.subscription || ""),
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const obj = event.data.object;
        const status = String(obj.status || "");
        applyPatch(userIdFromEvent(event), {
          plan: (status === "active" || status === "trialing") ? "premium" : "free",
          status,
          stripeCustomerId: String(obj.customer || ""),
          stripeSubscriptionId: String(obj.id || ""),
          currentPeriodEnd: obj.current_period_end
            ? new Date(obj.current_period_end * 1000).toISOString()
            : null,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const obj = event.data.object;
        applyPatch(userIdFromEvent(event), {
          plan: "free",
          status: "canceled",
          stripeSubscriptionId: String(obj.id || ""),
        });
        break;
      }
      case "invoice.payment_failed": {
        const obj = event.data.object;
        applyPatch(userIdFromEvent(event), { status: "past_due" });
        break;
      }
      default:
        // Acknowledge unhandled events to keep Stripe happy
        break;
    }

    res.json({ ok: true, received: event.type });
  } catch (e) {
    console.error("[BILLING] webhook handler error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

export default router;
