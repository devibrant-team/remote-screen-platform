// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],

  // Use relative URLs in production so Electron can load files via file://
  base: command === 'build' ? './' : '/',

  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
}));
