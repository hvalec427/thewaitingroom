The Waiting Room — Minimal FE/BE with WebSockets

Structure
- `BE/`: Node.js Express server with `ws` at `ws://localhost:3001/ws`.
- `FE/`: Static HTML page that connects over WebSocket and streams mouse coordinates.

Backend
1) Install deps
   - `cd BE`
   - `npm install`
2) Run
   - `npm run start`
   - Health: `http://localhost:3001/health`
   - WS: `ws://localhost:3001/ws`

Frontend
- Open `FE/index.html` directly in a browser, or serve statically with any server.
- It auto-connects to `ws://localhost:3001/ws`. To point elsewhere, append `?ws=ws://host:port/ws` to the page URL.

Root scripts (easier)
- Install root dev deps: `npm install`
- Start both FE (static at 3000) and BE (3001): `npm run dev`
- Start only backend: `npm run be`
- Start only frontend server: `npm run fe` then open `http://localhost:3000`

How it works
- On page load, a WebSocket connection is created.
- As you move the mouse over the canvas, the client sends normalized coordinates `{ type: 'mousemove', x, y }`.
- The backend receives and broadcasts to other clients as `{ type: 'peer-mousemove', x, y }`.

Notes
- Coordinates are normalized [0,1] relative to the visible canvas.
- The FE shows your dot (cyan) and a single peer dot (purple) if messages arrive.
