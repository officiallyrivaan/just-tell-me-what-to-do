# just tell me what to do

AI-powered decision fatigue eliminator. Dump your brain, get one action back.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add your Gemini API key
Edit `.env` and replace the placeholder:
```
GEMINI_API_KEY=your_actual_key_here
```
Get a free key at https://aistudio.google.com/app/apikey

### 3. Run locally
```bash
npm run dev    # development (auto-restarts on changes)
npm start      # production
```

Open http://localhost:3000

---

## How the API key is protected

Your Gemini key lives **only in `.env`** on the server — it is never sent to the browser.
The frontend calls `/api/decide` on your own Express server, which then calls Gemini internally.

```
Browser → POST /api/decide → server.js → Gemini API (key used here, server-side only)
```

The `.gitignore` file ensures `.env` is never committed to git.

## Deploying

### Vercel / Railway / Render
1. Push to GitHub (`.env` is gitignored — safe)
2. Add `GEMINI_API_KEY` as an environment variable in your hosting dashboard
3. Deploy

### VPS / DigitalOcean
```bash
cp .env.example .env   # fill in your key
npm install --production
npm start
```

Use PM2 or systemd to keep it running.

## Project structure

```
jtmwtd/
├── public/
│   └── index.html     # frontend (no API keys here)
├── server.js          # Express proxy — keeps key secret
├── package.json
├── .env               # YOUR KEY HERE (never commit)
├── .gitignore         # ignores .env
└── README.md
```
