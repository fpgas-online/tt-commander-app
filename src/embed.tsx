// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import '@xterm/xterm/css/xterm.css';
import { render } from 'solid-js/web';
import { EmbedApp, type EmbedOptions } from '~/components/EmbedApp';

export type { BoardInfo, BoardKind } from '~/model/board';
export type { EmbedOptions };

export function mountCommander(el: HTMLElement, opts: EmbedOptions): { unmount(): void } {
  const dispose = render(() => <EmbedApp options={opts} />, el);
  return {
    unmount() {
      dispose();
      el.replaceChildren();
    },
  };
}
