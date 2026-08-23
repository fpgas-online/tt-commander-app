// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import '@xterm/xterm/css/xterm.css';
import { render } from 'solid-js/web';
import { EmbedApp, type EmbedOptions } from '~/components/EmbedApp';
import { loadFpgaDesigns } from '~/model/fpgaDesigns';

export type { BoardInfo, BoardKind } from '~/model/board';
export type { EmbedOptions };

export interface CommanderHandle {
  unmount(): void;
  /**
   * Reloads the FPGA daemon's design list (e.g. after an upload elsewhere on
   * the host page). A no-op that resolves immediately for non-fpga boards.
   */
  refreshDesigns(): Promise<void>;
}

export function mountCommander(el: HTMLElement, opts: EmbedOptions): CommanderHandle {
  const dispose = render(() => <EmbedApp options={opts} />, el);
  return {
    unmount() {
      dispose();
      el.replaceChildren();
    },
    refreshDesigns() {
      return opts.board.kind === 'fpga' && opts.apiBase
        ? loadFpgaDesigns(opts.apiBase)
        : Promise.resolve();
    },
  };
}
