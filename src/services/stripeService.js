const Stripe = require('stripe');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !String(key).trim()) return null;
  return new Stripe(String(key).trim());
}

/**
 * Ensure Stripe customer and return Checkout URL for base + social add-ons.
 * Price IDs must be set in env: STRIPE_PRICE_BASE, STRIPE_PRICE_SOCIAL_FACEBOOK, etc.
 */
async function createCheckoutSessionForDeveloper(developerId, email, opts = {}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY)');

  const prisma = require('../db/prisma');
  const dev = await prisma.developer.findUnique({
    where: { id: developerId },
    include: { socialIntegrations: { orderBy: { platform: 'asc' } } },
  });
  if (!dev) throw new Error('Developer not found');

  let customerId = dev.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { developerId: String(developerId) },
    });
    customerId = customer.id;
    await prisma.developer.update({
      where: { id: developerId },
      data: { stripeCustomerId: customerId },
    });
  }

  const lineItems = [];
  const basePrice = process.env.STRIPE_PRICE_BASE;
  if (basePrice) {
    lineItems.push({ price: basePrice, quantity: 1 });
  }

  const socialMap = {
    FACEBOOK: process.env.STRIPE_PRICE_SOCIAL_FACEBOOK,
    TWITTER: process.env.STRIPE_PRICE_SOCIAL_TWITTER,
    LINKEDIN: process.env.STRIPE_PRICE_SOCIAL_LINKEDIN,
  };
  for (const row of dev.socialIntegrations ?? []) {
    if (!row.enabled) continue;
    const priceId = socialMap[row.platform];
    if (priceId) lineItems.push({ price: priceId, quantity: 1 });
  }

  if (lineItems.length === 0) {
    throw new Error('No Stripe prices configured. Set STRIPE_PRICE_BASE in environment.');
  }

  const baseUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    success_url: `${baseUrl}/dashboard?checkout=success`,
    cancel_url: `${baseUrl}/dashboard?checkout=cancel`,
    metadata: { developerId: String(developerId) },
  });

  return { url: session.url, sessionId: session.id };
}

async function createBillingPortalSession(developerId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const prisma = require('../db/prisma');
  const dev = await prisma.developer.findUnique({
    where: { id: developerId },
    select: { stripeCustomerId: true },
  });
  if (!dev?.stripeCustomerId) throw new Error('No billing account yet');
  const baseUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  const session = await stripe.billingPortal.sessions.create({
    customer: dev.stripeCustomerId,
    return_url: `${baseUrl}/dashboard`,
  });
  return { url: session.url };
}

async function handleSubscriptionWebhook(event) {
  const stripe = getStripe();
  if (!stripe) return;
  const prisma = require('../db/prisma');

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const developerId = Number(session.metadata?.developerId);
    if (!Number.isFinite(developerId)) return;
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      await prisma.developer.update({
        where: { id: developerId },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null,
        },
      });
    }
    return;
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const dev = await prisma.developer.findFirst({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!dev) return;
    await prisma.developer.update({
      where: { id: dev.id },
      data: {
        subscriptionStatus: sub.status,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      },
    });
  }
}

module.exports = {
  getStripe,
  createCheckoutSessionForDeveloper,
  createBillingPortalSession,
  handleSubscriptionWebhook,
};
