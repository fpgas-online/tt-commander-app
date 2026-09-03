// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import suidPlugin from '@suid/vite-plugin';
import child from 'child_process';
import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const commitHash = child.execSync('git rev-parse --short HEAD').toString().trim();

/** Library build of the Commander for embedding in tinytapeout.fpgas.online pages. */
export default defineConfig({
  plugins: [suidPlugin(), solidPlugin()],

  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },

  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // Vite leaves `process.env.NODE_ENV` alone in library mode (it expects the
    // consumer's bundler to define it); the embed is loaded straight from a
    // <script type="module">, where a bare `process` reference is a ReferenceError.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },

  // The host page owns its own favicon/assets; a lib build should not copy public/.
  publicDir: false,

  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    // The bundle is minified and inlines every dependency; without a map a
    // host-page stack trace is unreadable.
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/embed.tsx'),
      name: 'TTCommander',
      formats: ['es'],
      fileName: () => 'tt-commander-embed.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'tt-commander-embed.[ext]' },
    },
  },
});
