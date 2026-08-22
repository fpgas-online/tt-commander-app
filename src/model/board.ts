// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { createStore } from 'solid-js/store';

export type BoardKind = 'asic' | 'kianv' | 'fpga';

export interface BoardInfo {
  slug: string;
  kind: BoardKind;
  shuttle?: string;
  apiBase?: string;
}

/** Which board this Commander instance is driving (embedded mode). Later phases read kind/apiBase. */
export const [boardInfo, setBoardInfo] = createStore<BoardInfo>({ slug: '', kind: 'asic' });
