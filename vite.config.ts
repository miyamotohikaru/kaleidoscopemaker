import { defineConfig } from 'vite';

// 本体と、こすくまくんの声を選ぶページ（voice.html）の2枚
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', voice: 'voice.html' },
    },
  },
});
