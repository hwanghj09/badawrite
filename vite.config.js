import { defineConfig } from 'vite';

export default defineConfig({
  base: '/badawrite/',
  // Worker-only imports must be ready before generation or Vite reloads away the script.
  optimizeDeps: { include: ['kokoro-js', '@huggingface/transformers', 'phonemizer'] },
});
