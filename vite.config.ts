import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import framex from './api/framex.ts'

/** Runs the catalog relay (api/framex.ts, a Vercel Function in production) in the dev server. */
function catalogRelay(): Plugin {
  return {
    name: 'playpen-catalog-relay',
    configureServer(server) {
      server.middlewares.use('/api/framex', async (req, res) => {
        const response = await framex.fetch(new Request(`http://localhost${req.originalUrl}`, { method: req.method }))
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), catalogRelay()],
  server: { port: 5173 },
  build: {
    // Supabase's client brings its whole SDK (auth, storage, database, realtime), which puts
    // the bundle just over Vite's 500 kB default (about 150 kB gzipped). Fine for this app.
    chunkSizeWarningLimit: 700,
  },
})
