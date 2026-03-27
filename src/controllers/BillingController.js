const stripeService = require("../services/stripeService");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { respondError } = require("../utils/httpErrors");

class BillingController {
  async checkout(req, res) {
    try {
      const { developer } = await resolveDeveloperFromSession(req);
      if (!developer) return respondError(res, 404, "No developer record", "Create a profile first");
      const email = req.session?.user?.email;
      if (!email) return respondError(res, 400, "Missing email", "");
      const { url } = await stripeService.createCheckoutSessionForDeveloper(developer.id, email);
      res.json({ ok: true, url });
    } catch (err) {
      respondError(res, 500, "Checkout failed", err?.message);
    }
  }

  async portal(req, res) {
    try {
      const { developer } = await resolveDeveloperFromSession(req);
      if (!developer) return respondError(res, 404, "No developer record", "");
      const { url } = await stripeService.createBillingPortalSession(developer.id);
      res.json({ ok: true, url });
    } catch (err) {
      respondError(res, 500, "Portal failed", err?.message);
    }
  }

  async webhook(req, res) {
    const stripe = stripeService.getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return res.status(500).send("Stripe webhook not configured");

    try {
      const sig = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(req.body, sig, secret);
      await stripeService.handleSubscriptionWebhook(event);
      res.json({ received: true });
    } catch (err) {
      const msg = process.env.NODE_ENV === "production" ? "Webhook Error" : `Webhook Error: ${err?.message}`;
      res.status(400).send(msg);
    }
  }
}

module.exports = new BillingController();
