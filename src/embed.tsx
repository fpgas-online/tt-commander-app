// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { EmbedApp, type EmbedOptions } from '~/components/EmbedApp';

export type { EmbedOptions };

export interface CommanderHandle {
  unmount(): void;
}

export function mountCommander(el: HTMLElement, opts: EmbedOptions): CommanderHandle {
  const dispose = render(() => <EmbedApp options={opts} />, el);
  return {
    unmount() {
      dispose();
      el.replaceChildren();
    },
  };
}
