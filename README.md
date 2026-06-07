# X3 Alpha — AI Trading Journal (with email sign-in + Stripe Pro)

A trading journal that uses Claude to analyze trades. Includes passwordless email
sign-in, a database to remember who's signed in and who's paying, and a Stripe
webhook so Pro follows the customer across devices.

```
x3-alpha/
├─ index.html              the app
├─ package.json            marks the API as ES modules (no extra installs)
├─ api/
│  ├─ _lib.js              shared helpers (storage, sessions, cookies)
│  ├─ analyze.js           AI analysis — requires sign-in, enforces limits
│  ├─ me.js                returns the signed-in user + Pro status
│  ├─ logout.js            ends the session
│  ├─ stripe-webhook.js    marks a user Pro when they pay (and un-Pro on cancel)
│  └─ auth/
│     ├─ request.js        emails the one-tap sign-in link
│     └─ verify.js         validates the link, starts a session
└─ README.md
```

## How sign-in + Pro fit together (plain English)

- **Sign-in** proves who someone is. It's passwordless: they enter an email, get a
  one-tap link, and a session cookie keeps them signed in (30 days, any device).
- **Stripe** proves who's paying. When someone checks out, Stripe calls
  `/api/stripe-webhook`, and we flip that email to Pro. Cancel → back to Free.
- Because Pro is stored against the **email**, signing in on a new phone/laptop
  just works. (Customers should pay with the same email they sign in with — the
  upgrade button passes their email to Stripe automatically.)

## Replace these two values

In `index.html`, CONFIG block near the bottom of the <script>:
- `STRIPE_PRO_LINK` → your Stripe Payment Link
- `SUPPORT_EMAIL`   → your support email

## Accounts you'll connect (all have free tiers)

1. **Anthropic** (the AI) — get an API key at console.anthropic.com.
2. **Upstash** (the database) — create a free Redis database; copy its
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **Resend** (sends the sign-in emails) — get an API key. For testing you can send
   from `onboarding@resend.dev` to your own email. For real customers, verify
   `x3digitalcapital.com` in Resend (it gives you DNS records to add at Northwest),
   then set `EMAIL_FROM` to e.g. `X3 Alpha <noreply@x3digitalcapital.com>`.
4. **Stripe** — create a $29/mo Payment Link. In the link's settings set the
   "After payment" redirect to `https://alpha.x3digitalcapital.com/?checkout=success`.
   Then create a webhook (Developers → Webhooks → Add endpoint):
   - URL: `https://alpha.x3digitalcapital.com/api/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`,
     `customer.subscription.updated`
   - Copy the signing secret → that's `STRIPE_WEBHOOK_SECRET`.

## Deploy to Vercel

1. vercel.com → Add New → Project → drag in the `x3-alpha` folder.
2. Settings → Environment Variables → add all of these, then redeploy:

   | Variable | What it is |
   |---|---|
   | `ANTHROPIC_API_KEY` | Anthropic key |
   | `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |
   | `RESEND_API_KEY` | Resend key |
   | `EMAIL_FROM` | (optional) your verified from-address |
   | `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
   | `APP_URL` | (optional) e.g. https://alpha.x3digitalcapital.com |
   | `FREE_DAILY_LIMIT` | (optional) free analyses/day, default 1 |

3. Domains → add `alpha.x3digitalcapital.com`, then add the CNAME it shows you at Northwest.

## Cost

~$0.01 per analysis on Claude Haiku 4.5 (the default). Upstash/Resend free tiers
cover early usage. Set a spend limit in your Anthropic account to be safe.

## Notes

- Free-analysis limits are now enforced **server-side** per signed-in email, and
  analysis requires sign-in — so the API endpoint can't be abused anonymously.
- Keep the disclaimer in the footer. X3 Alpha reviews past trades for patterns and
  is not financial advice.
