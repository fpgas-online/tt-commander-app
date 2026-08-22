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
  },

  // The host page owns its own favicon/assets; a lib build should not copy public/.
  publicDir: false,

  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
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
