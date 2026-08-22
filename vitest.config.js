// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

/**
 * Vitest runs modules through Vite's SSR pipeline, which resolves `solid-js`
 * (and `@suid/*`) with node/server export conditions. Rendering a Solid
 * component under jsdom then blows up ("Client-only API called on the server
 * side", or a dev/prod split between `solid-js` and `solid-js/store`).
 * Forcing the browser+development conditions for both inlined and externalised
 * dependencies keeps the whole graph on the client build. This lives in its own
 * config so the production builds (`vite.config.js`, `vite.embed.config.js`)
 * keep Vite's default client conditions.
 *
 * If a dependency ever resolves to the wrong build here (a package that only
 * ships a `module` condition, say), add it to `test.server.deps.inline` so Vite
 * transforms it with these conditions instead of letting Node import it raw.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: { conditions: ['development', 'browser'] },
    ssr: {
      resolve: {
        conditions: ['development', 'browser'],
        externalConditions: ['development', 'browser'],
      },
    },
    test: { environment: 'jsdom' },
  }),
);
