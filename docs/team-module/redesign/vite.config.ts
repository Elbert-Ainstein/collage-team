import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // `--mode artifact` produces one self-contained HTML (fonts inlined) for
    // publishing live previews; the normal build is untouched
    ...(mode === 'artifact' ? [viteSingleFile()] : []),
  ],
  build:
    mode === 'artifact'
      ? { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 100_000 }
      : {},
}))
