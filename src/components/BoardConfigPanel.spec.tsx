// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { afterEach, describe, expect, test } from 'vitest';
import { setBoardInfo } from '~/model/board';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { BoardConfigPanel } from './BoardConfigPanel';

/** A carrier that never delivers or accepts a byte: the panel never talks to it. */
class InertTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readonly readable = new ReadableStream<Uint8Array>();
  readonly writable = new WritableStream<Uint8Array>();
  async close() {
    this.state = 'closed';
  }
}

/** `setData` is private; the panel only ever reads what the device recorded. */
function setDeviceData(device: TTBoardDevice, key: string, value: unknown) {
  (device as unknown as { setData(key: string, value: unknown): void }).setData(key, value);
}

function renderPanel(device = new TTBoardDevice(new InertTransport())) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <BoardConfigPanel device={device} />, host);
  return { host, device, dispose };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.innerHTML = '';
  setBoardInfo({ slug: '', kind: 'asic', apiBase: undefined });
});

function panel(device?: TTBoardDevice) {
  const rendered = renderPanel(device);
  cleanups.push(() => {
    rendered.dispose();
    rendered.host.remove();
  });
  return rendered;
}

function labels(host: HTMLElement) {
  return [...host.querySelectorAll('label')].map((l) => l.textContent);
}

function buttonTexts(host: HTMLElement) {
  return [...host.querySelectorAll('button')].map((b) => b.textContent);
}

describe('BoardConfigPanel (asic)', () => {
  test('offers the mux Index field and a Select button', () => {
    const { host } = panel();
    expect(labels(host)).toContain('Index');
    expect(buttonTexts(host)).toContain('Select');
  });
});

describe('BoardConfigPanel (fpga)', () => {
  test('hides the mux Index field and loads designs by name', () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const { host } = panel();
    expect(labels(host)).not.toContain('Index');
    expect(buttonTexts(host)).toContain('Load design');
    expect(buttonTexts(host)).not.toContain('Select');
  });

  test('renders when the board reports no parseable firmware version', () => {
    // Issue #7: an FPGA board answers `unknown`, which used to throw out of the
    // version comparison during render and blank the whole tab.
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const device = new TTBoardDevice(new InertTransport());
    setDeviceData(device, 'version', 'unknown');
    const { host } = panel(device);
    expect(buttonTexts(host)).toContain('Load design');
  });

  test('shows a daemon error and lets the user dismiss it', () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const device = new TTBoardDevice(new InertTransport());
    const { host } = panel(device);
    expect(host.textContent).not.toContain('another task is running');

    setDeviceData(device, 'designError', 'another task is running');
    expect(host.textContent).toContain('another task is running');

    host.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    expect(device.data.designError).toBeNull();
    expect(host.textContent).not.toContain('another task is running');
  });
});
