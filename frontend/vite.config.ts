import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Le proxy /api garde frontend et API sur la même origine : cookie de session
// « SameSite=Strict » et identifiant WebAuthn (rpID = localhost) cohérents.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5250,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4500' },
  },
});
