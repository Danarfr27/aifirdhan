Logs forwarding and tracking

This repository contains a simple logs writer (`api/chat.js`) that now stores chat logs in `./logs/logs.json` and can forward each log entry to an external log receiver (a remote site) for centralized viewing.

Configuration (set in environment)

- `LOG_FORWARD_URL` (optional): full URL to send POST requests containing each log entry as JSON. If you want logs forwarded to `https://logswormhistory.vercel.app/`, set this to that full URL (for example `https://logswormhistory.vercel.app/ingest` or `https://logswormhistory.vercel.app/`).
- `LOG_FORWARD_KEY` (optional): if your remote log receiver expects a secret header, set it here; the header `x-log-forward-key` will be sent.
- `LOG_VIEW_KEY` (optional): protects `api/logs` in this repo by requiring `?key=...` or `x-log-key` header.

What is included in each log entry

- `id`: generated id for the log entry
- `timestamp`: ISO timestamp
- `ip`: requester IP
- `network`: headers (userAgent, via, forwarded, referer)
- `geo`: ip-api.com response (includes `country`, `city`, `lat`, `lon`, `isp`, `org` when available)
- `provider`: convenience field set to `isp` or `org` if available
- `request.contents`: the chat contents you sent to the model
- `responseSummary.truncated`: short truncated JSON of the model response

Forwarding behavior

- After a successful generation, `api/chat.js` will append locally and then POST the same entry to `LOG_FORWARD_URL` (if present). This is best-effort: failures won't block the chat response.

How to track visitors who click your chatbot link

Because you said your chatbot is at `https://ai-firdhan.vercel.app/` and you want to know who accessed it, you have two easy options:

1. Use a redirect/tracking link (recommended)

- Replace public links to your chatbot (or button targets) with a redirect URL hosted on your logs site. Example:
  - `https://logswormhistory.vercel.app/visit?u=https://ai-firdhan.vercel.app/`
- The `visit` handler on `logswormhistory.vercel.app` should log the click (IP, user agent, timestamp, etc.) then redirect the user to the real `ai-firdhan` URL.
- If you want, I can provide a small `visit` handler (Node/Vercel serverless or static HTML + JS) you can deploy on `logswormhistory.vercel.app`.

2. Use referer tracking (no redirect)

- If your chatbot page includes resources or makes calls to your own backend (for example to `POST /api/chat`), those requests will include a `referer` header. The updated logs include `network.referer` so you can filter logs where the referer equals `https://ai-firdhan.vercel.app/`.
- This requires that the chat requests pass through the `api/chat.js` we modified (or forward logs with referer preserved).

Next steps I implemented for you in this repo

- `api/receive.js`: POST endpoint to ingest forwarded logs and GET to list received logs. It verifies `LOG_FORWARD_KEY` for POST and `LOG_VIEW_KEY` for GET when those env vars are set. Stores to `logs/received.json`.
- `api/visit.js`: redirect tracker that logs visits to `logs/visits.json` and redirects to the provided `u` query parameter. Useful as a tracking redirect for links to `ai-firdhan`.
- `logs/received.json`, `logs/visits.json`: initial empty arrays stored in `logs/`.
- `.env.example`: example environment variables and explanation for both chatbot and logs projects.

Which project needs `.env`?

- Chatbot project (e.g. `ai-firdhan`): MUST contain `GEMINI_API_KEYS` and, if forwarding logs, `LOG_FORWARD_URL` plus `LOG_FORWARD_KEY`.
- Logs/receiver project (e.g. `logswormhistory`): MUST contain `LOG_FORWARD_KEY` (to validate forwards) and optionally `LOG_VIEW_KEY` (to protect viewing logs). If you use a database, also put the DB connection string here.

Quick test commands (local)

1. Test receive POST (simulate forward from chatbot):

```bash
curl -X POST 'http://localhost:3000/api/receive' \
  -H 'Content-Type: application/json' \
  -H 'x-log-forward-key: your-forward-key' \
  -d '{"id":"test-1","timestamp":"2025-12-10T00:00:00Z","ip":"1.2.3.4","request":{"contents":"hello"}}'
```

2. View received logs (if `LOG_VIEW_KEY` is set, add `?key=`):

```bash
curl 'http://localhost:3000/api/receive?limit=20'
```

3. Test visit redirect (opens a redirect and logs the click):

```bash
# This will return a 302 redirect to https://ai-firdhan.vercel.app/
curl -v 'http://localhost:3000/api/visit?u=https://ai-firdhan.vercel.app/&label=promo'
```

Deployment notes

- On Vercel, set the environment variables in Project Settings → Environment Variables.
- Make sure `LOG_FORWARD_URL` from the chatbot points to the `api/receive` endpoint of your logs project, and that `LOG_FORWARD_KEY` values match between the two projects.

If you want, I can also:

- Add HMAC signing of forwarded payloads and verification on `api/receive`.
- Replace JSON-file storage with SQLite and add pagination endpoints.
- Create a small admin UI on `logswormhistory` to browse `received.json` and `visits.json` with better filtering.

Tell me which of these you want next and I'll implement it.
