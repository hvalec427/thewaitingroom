# Presence

A free, no-login embeddable script. Anyone can add
`https://presence.hvalec.com/widget.js` to their site and get a live visitor
count, live peer cursors, and floating typed chat bubbles, scoped to a room
name of their choosing.

## Routes

| Route             | Description                                                   |
|--------------------|-----------------------------------------------------------------|
| `GET /`            | Product landing page                                           |
| `GET /widget.js`   | The embeddable presence script (static file)                   |
| `GET /:room`       | Self-serve setup page for a room: embed snippet + live demo    |
| `GET /health`      | Health check, returns `{ ok: true }`                            |
| `WS /ws?room=<id>` | Presence + live cursor/typing broadcast channel, namespaced per room |

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
goal). Rooms are unlisted, not private: there's no access control beyond not
telling someone the room name. There is no server-side rendering per room
beyond the setup page; state lives in memory per room and resets on server
restart.

### Widget options

The `<script>` tag also accepts:

| Attribute              | What it does                                                              |
|--------------------------|------------------------------------------------------------------------|
| `data-badge="false"`     | Hides the visitor-count badge                                          |
| `data-cursors="false"`   | Fully disables cursors — nothing rendered or sent                      |
| `data-messages="false"`  | Fully disables typing bubbles — nothing captured, rendered, or sent    |
| `data-uid="…"`           | Overrides the auto-generated, `sessionStorage`-persisted visitor identity |

It also dispatches a `presence:update` event on `window` (`detail: { room,
count, you }`) so a page can build its own UI instead of the built-in badge.

## File layout

- `server.js` — Express app: serves `public/`, and runs a `ws` WebSocket
  server (mounted at `/ws`) with per-room presence state.
- `public/landing.html` — the product landing page (`/`).
- `public/widget.js` — the embeddable presence script.
- `public/room.html` — server-templated setup page for `/:room`.

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
