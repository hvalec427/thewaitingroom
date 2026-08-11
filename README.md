# Presence

A single Node process that does two things:

1. **Presence widget** — a free, no-login embeddable script. Anyone can add
   `https://presence.hvalec.com/widget.js` to their site and get a live visitor
   count, live peer cursors, and floating typed chat bubbles, scoped to a room
   name of their choosing.
2. **The Waiting Room** — the original single-page "waiting room" kept at
   `/waiting-room`: a synchronized countdown, live queue position, and the same
   cursor/typing presence, for sharing ahead of a specific event.

## Routes

| Route                | Description                                                              |
|-----------------------|---------------------------------------------------------------------------|
| `GET /`               | Product landing page                                                     |
| `GET /widget.js`      | The embeddable presence script (static file)                             |
| `GET /:room`          | Self-serve setup page for a room: embed snippet + live demo              |
| `GET /waiting-room`   | The original waiting room page                                           |
| `GET /health`         | Health check, returns `{ ok: true }`                                     |
| `GET /celebration-date` | Waiting room countdown target/start timestamps                         |
| `GET /celebration`    | Called client-side when the waiting room countdown hits zero             |
| `WS /ws?room=<id>`    | Presence + live cursor/typing broadcast channel, namespaced per room     |

## How the presence widget works

Anyone visits `https://presence.hvalec.com/<room-name>` and gets a copy-paste
snippet:

```html
<script src="https://presence.hvalec.com/widget.js" data-room="room-name" async></script>
```

Dropped into any site, it:

- opens a WebSocket to `/ws?room=room-name` on this server,
- shows a small fixed badge with the live visitor count,
- renders other visitors' cursors and typed messages as a pointer-events-none
  overlay across the page,
- captures typing globally *except* when focus is inside the host page's own
  inputs, textareas, selects, or contenteditable elements, so it never
  interferes with the embedding site's own forms.

Rooms are just strings — there is no signup or ownership, so two sites using
the same room name will share presence (by design, matching the "no login"
goal). There is no server-side rendering per room beyond the setup page; state
lives in memory per room and resets on server restart.

## The Waiting Room

Everyone who opens `/waiting-room` sees a live countdown to the same target
date/time, their live queue position, how many other people are currently
waiting, and each other's mouse cursors and typed messages in real time. When
the countdown hits zero, everyone is redirected onward.
Refreshing the page sends you to the back of the line (a new queue position).

### Configuring the target date

Edit the constants at the top of `server.js`:

```js
const EVENT_MONTH = 0;   // 0 = January
const EVENT_DAY = 22;
const EVENT_HOUR = 14;   // 24h, interpreted in UTC
const EVENT_MINUTE = 44;
```

The server always targets the next occurrence of that month/day/time (this
year if it hasn't passed yet, otherwise next year), and once that date/time
has passed on the day itself, `/celebration-date` reports `redirectNow: true`
so late visitors are sent onward immediately.

The countdown display is rendered in the `Europe/Ljubljana` timezone (see the
`tz` constant in `public/waiting-room.js`) — change that if you want a
different display timezone.

## File layout

- `server.js` — Express app: serves `public/`, exposes the countdown API, and
  runs a `ws` WebSocket server (mounted at `/ws`) with per-room presence
  state.
- `public/landing.html` — the product landing page (`/`).
- `public/widget.js` — the embeddable presence script.
- `public/room.html` — server-templated setup page for `/:room`.
- `public/waiting-room.html` / `public/waiting-room.js` — the waiting room
  page.

## Running locally

Requires Node.js and Yarn.

```bash
yarn install
yarn dev      # or: yarn start
```

Then open `http://localhost:3001`.

## Deploying

Deploy as any Node.js web service (e.g. Coolify, Render, Fly.io, a plain VPS):

- Build/start command: `yarn install && yarn start`
- The server listens on `process.env.PORT` (defaults to `3001`) — set `PORT` if
  your platform requires a specific one.
- No other environment variables or external services are required.
