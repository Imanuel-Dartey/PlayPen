import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // Supabase's client brings its whole SDK (auth, storage, database, realtime), which puts
    // the bundle just over Vite's 500 kB default (about 150 kB gzipped). Fine for this app.
    chunkSizeWarningLimit: 700,
  },
})
