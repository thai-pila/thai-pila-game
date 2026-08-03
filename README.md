# thai-pila-game

THAI PILA games built with Phaser 3 + Webpack + TypeScript.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Point to the API (optional, for a local backend)

By default the code targets production:

```ts
// src/core/api.ts


To use a local `thai-pila-api`, change it to:

```ts
export const API_BASE_URL = "http://localhost:3001";
```

> Do not commit internal server URLs or credentials that should stay private.

### 3. Start the development server

```bash
npm run dev
```

The Webpack dev server opens at [http://localhost:3001](http://localhost:3001).

**Note:** Port `3001` conflicts with `thai-pila-api`.  
If you run both at the same time, change the port in `webpack/webpack.dev.js`, for example:

```js
devServer: {
  port: 8080,
  // ...
}
```

Then open [http://localhost:8080](http://localhost:8080) instead.

### 4. Testing without URL params

If you open the page with no query string, the game uses the fallback UUIDs in `src/main.ts` (`DEV_FALLBACK_*`).  
Update those UUIDs to match your local database when testing locally.

Example URLs with real UUIDs:

```text
http://localhost:8080/?game=<game-uuid>
http://localhost:8080/?sequence=<sequence-uuid>
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start webpack-dev-server (hot reload) |
| `npm run build` | Production build to the `dist` folder |
| `npm run build:dev` | Build with the development config |

## Deploy

```bash
npm run build
```

Upload everything inside the `dist` folder to your web server.

## Related projects

| Project | Role |
|---------|------|
| `thai-pila-api` | Backend that serves game data |
| `thai-pila-create` | Create and edit game content |
| `thai-pila-web` | Public website |
