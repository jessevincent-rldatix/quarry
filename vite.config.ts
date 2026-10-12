import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const vad = path.resolve(here, 'node_modules/@ricky0123/vad-web')
// The voice detector loads these by file name from one folder at run time, so they cannot go through the bundler.
// The runtime must be the copy the detector was built against, which is the one nested under it when versions differ.
const ortDist = [path.join(vad, 'node_modules/onnxruntime-web/dist'), path.resolve(here, 'node_modules/onnxruntime-web/dist')].find((dir) => fs.existsSync(dir))!
const VOICE_ASSETS: Record<string, string> = {
  'silero_vad_v5.onnx': path.join(vad, 'dist/silero_vad_v5.onnx'),
  'vad.worklet.bundle.min.js': path.join(vad, 'dist/vad.worklet.bundle.min.js'),
  'ort-wasm-simd-threaded.wasm': path.join(ortDist, 'ort-wasm-simd-threaded.wasm'),
  'ort-wasm-simd-threaded.mjs': path.join(ortDist, 'ort-wasm-simd-threaded.mjs'),
}
const MIME: Record<string, string> = { '.onnx': 'application/octet-stream', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' }

/** Serves the voice detector's files at /voice/ while developing, and copies them into the build. */
const voiceAssets = (): Plugin => ({
  name: 'quarry-voice-assets',
  configureServer(server) {
    server.middlewares.use('/voice', (req, res, next) => {
      const file = VOICE_ASSETS[(req.url ?? '').split('?')[0].replace(/^\//, '')]
      if (!file) return next()
      res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream')
      fs.createReadStream(file).pipe(res)
    })
  },
  generateBundle() {
    for (const [name, file] of Object.entries(VOICE_ASSETS)) this.emitFile({ type: 'asset', fileName: `voice/${name}`, source: fs.readFileSync(file) })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), voiceAssets()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@shared': path.resolve(here, 'shared'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4781,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.QUARRY_PORT ?? 4780}` },
  },
})
