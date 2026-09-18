# Medi AI — Your Health Companion

A multilingual medical AI assistant web app (PWA-ready):

- **Medical Chatbot** — health questions answered with a grounded medical knowledge base
- **Report Lens** — upload a photo of a lab report; text is extracted on-device (OCR) and explained simply
- **10 AI engines** — Groq, Sarvam, Mistral, Gemini, OpenRouter, Together, Cohere, Cerebras, SambaNova, Plugsky — with automatic fallback if one fails
- **50+ languages** — replies in the user's chosen language, voice input included
- **Plans & credits** — Free / Plus / Pro with a credit system and an admin panel
- **Emergency detection** — urgent queries trigger a prominent emergency warning
- **PWA** — installable on Android/iOS home screens; ready to package for the Google Play Store

> Medi AI gives general health information, not medical diagnoses. Always consult a qualified doctor. In an emergency call 112 (India).

## Quick start (local)

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost/medi GROQ_API_KEY=your-key node server.js
# open http://localhost:3000
```

You need a PostgreSQL database (any provider). The easiest free option is
[Neon](https://neon.tech) — create a project, copy the connection string
into `DATABASE_URL`. Users sign up with **email + username + password** and
can log in with either email or username.

The first user you sign up becomes the **admin** and can change plans from the Admin panel in the sidebar.

## Deploy on Render

1. Push this repo to GitHub.
2. Render → New → **Web Service** → connect the repo.
3. Build command: `npm install`  Start command: `npm start`
4. Add environment variables (at minimum `SESSION_SECRET`, `DATABASE_URL` — a free Neon Postgres connection string — and one AI key; see `.env.example`).
5. Deploy. Done.

All data lives in PostgreSQL (Neon), so users, chats, reports and payments survive every redeploy.

## API keys

Add keys only for providers you have. The app shows available providers automatically and falls back between them when one fails.

## Google AdSense

The AdSense loader script is already included in `public/index.html` (publisher ID `ca-pub-2202766425562142`). Ads appear once Google approves the site in your AdSense dashboard — add ad unit `<ins>` blocks at that point.

## Installable app / Play Store

- On Android/iOS: open the site → browser menu → **Add to Home Screen**.
- For the Google Play Store: package this PWA with PWABuilder (pwabuilder.com) — it generates a signed Android package from the site URL. You will need a Google Play developer account ($25, one time).

## Project layout

```
server.js                 Express app: auth, chats, credits, admin
ai.js                     10-provider AI engine with fallback
db.js                     PostgreSQL: users, chats, messages, medical knowledge base
public/index.html         App shell (AdSense script in <head>)
public/style.css          Luxe dark/gold theme
public/app.js             Client logic: chat, OCR, voice, settings, admin
public/sw.js              Service worker (offline app shell)
public/manifest.webmanifest
```

## v1.1 features

- **Dashboard** — credits, plan, chat & report stats, recent activity
- **Saved Reports** — every Report Lens analysis is stored, viewable and deletable
- **Pricing page** — plans with Razorpay checkout (needs `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`)
- **Coupons** — admin creates them (instant credits or % off); users redeem on the Pricing page
- **Report a problem** — users send bug reports; admins view and close them
- **About page** — what Medi AI is and its safety limits
- **Admin panel** — tabs: Users, Knowledge (add/delete KB topics), Coupons, Problems, Status
- **WhatsApp bot** — `/whatsapp/webhook` answers health questions via WhatsApp (needs `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID`)
- **AI model auto-discovery** — if a provider retires a model, the app switches automatically
