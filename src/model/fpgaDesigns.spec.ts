import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceState } from './DeviceState';
import {
  DaemonError,
  designToProject,
  enableFpgaDesign,
  fpgaDesigns,
  loadFpgaDesigns,
  pinoutFromDesign,
} from './fpgaDesigns';
import { shuttle } from './shuttle';

const designs = [
  {
    name: 'my_upload',
    title: '',
    author: '',
    description: '',
    docs_url: '',
    repo_url: '',
    clock_hz: null,
    pinout: {},
    source: 'upload',
  },
  {
    name: 'tt_um_demo_a',
    title: 'Demo A',
    author: 'fpgas.online',
    description: 'First demo',
    docs_url: 'https://example.org/a',
    repo_url: 'https://github.com/fpgas-online/tinytapeout-fpga-demos',
    clock_hz: 1000,
    pinout: {
      ui_in: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
      uo_out: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'],
      uio: ['', '', '', '', '', '', '', ''],
    },
    source: 'demo',
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('designToProject', () => {
  it('maps daemon designs onto shuttle projects (address = list index)', () => {
    const p = designToProject(designs[1] as never, 1);
    expect(p).toMatchObject({
      macro: 'tt_um_demo_a',
      address: 1,
      title: 'Demo A',
      author: 'fpgas.online',
      clock_hz: 1000,
      danger_level: 'safe',
      type: 'project',
      commit: '',
      repo: 'https://github.com/fpgas-online/tinytapeout-fpga-demos',
    });
    expect(designToProject(designs[0] as never, 0)).toMatchObject({
      title: 'my_upload',
      clock_hz: 0,
    });
  });
});

describe('pinoutFromDesign', () => {
  it('maps ui_in/uo_out/uio pin lists onto ui[i]/uo[i]/uio[i] keys', () => {
    expect(pinoutFromDesign(designs[1] as never)).toEqual({
      'ui[0]': 'a0',
      'ui[1]': 'a1',
      'ui[2]': 'a2',
      'ui[3]': 'a3',
      'ui[4]': 'a4',
      'ui[5]': 'a5',
      'ui[6]': 'a6',
      'ui[7]': 'a7',
      'uo[0]': 'o0',
      'uo[1]': 'o1',
      'uo[2]': 'o2',
      'uo[3]': 'o3',
      'uo[4]': 'o4',
      'uo[5]': 'o5',
      'uo[6]': 'o6',
      'uo[7]': 'o7',
      'uio[0]': '',
      'uio[1]': '',
      'uio[2]': '',
      'uio[3]': '',
      'uio[4]': '',
      'uio[5]': '',
      'uio[6]': '',
      'uio[7]': '',
    });
  });

  it('omits keys for pin lists absent from the design', () => {
    expect(pinoutFromDesign(designs[0] as never)).toEqual({});
  });
});

describe('loadFpgaDesigns', () => {
  it('fills the shuttle store and the designs store from GET /designs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs }));
    vi.stubGlobal('fetch', fetchMock);
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
    expect(shuttle.id).toBe('FPGA');
    expect(shuttle.loading).toBe(false);
    expect(shuttle.projects.map((p) => [p.macro, p.address])).toEqual([
      ['my_upload', 0],
      ['tt_um_demo_a', 1],
    ]);
    expect(fpgaDesigns.enabled).toBe('tt_um_demo_a');
    expect(fpgaDesigns.byName.tt_um_demo_a.pinout.uo_out[0]).toBe('o0');
    expect(fpgaDesigns.error).toBeNull();
  });

  it('records an error and leaves projects empty when the daemon answers an error JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'board not present', detail: '' }, 503)),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(shuttle.projects).toEqual([]);
    expect(shuttle.loading).toBe(false);
    expect(fpgaDesigns.error).toBe('board not present');
  });
});

describe('enableFpgaDesign', () => {
  it('POSTs the clock and returns the daemon body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', clock_hz: 1000 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(enableFpgaDesign('/api/board/fpga-1', 'tt_um_demo_a', 1000)).resolves.toEqual({
      enabled: 'tt_um_demo_a',
      clock_hz: 1000,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/board/fpga-1/designs/tt_um_demo_a/enable');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ clock_hz: 1000 });
  });

  it('throws DaemonError with the daemon message and detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'REPL task failed', detail: 'someone typed' }, 502)),
    );
    await expect(enableFpgaDesign('/api/board/fpga-1', 'x')).rejects.toMatchObject({
      error: 'REPL task failed',
      detail: 'someone typed',
      status: 502,
    } satisfies Partial<DaemonError>);
  });
});

describe("selection follows the daemon's enabled design", () => {
  it('points the selection at the enabled design after a load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs })),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(shuttle.projects[deviceState.selectedDesign].macro).toBe('tt_um_demo_a');
    expect(deviceState.selectedSubtile).toBeNull();
  });

  it('re-derives the index when a refresh shifts the design list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs })),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    const before = deviceState.selectedDesign;

    // An upload sorting before both existing designs shifts every index after
    // it; the selection must still name the design the daemon has enabled.
    const inserted = { ...designs[0], name: 'aaa_new_upload' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs: [inserted, ...designs] })),
    );
    await loadFpgaDesigns('/api/board/fpga-1');

    expect(deviceState.selectedDesign).toBe(before + 1);
    expect(shuttle.projects[deviceState.selectedDesign].macro).toBe('tt_um_demo_a');
  });

  it('follows the name the daemon reports back from an enable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs })),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(shuttle.projects[deviceState.selectedDesign].macro).toBe('tt_um_demo_a');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'my_upload', clock_hz: null })),
    );

    await enableFpgaDesign('/api/board/fpga-1', 'my_upload');

    expect(shuttle.projects[deviceState.selectedDesign].macro).toBe('my_upload');
  });

  it('leaves the selection alone when nothing is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs })),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    const before = deviceState.selectedDesign;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ enabled: null, designs })),
    );

    await loadFpgaDesigns('/api/board/fpga-1');

    expect(deviceState.selectedDesign).toBe(before);
  });
});

describe('daemon request shape', () => {
  it('keeps the Accept header when the caller supplies its own headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'x', clock_hz: null }));
    vi.stubGlobal('fetch', fetchMock);
    await enableFpgaDesign('/api/board/fpga-1', 'x', 1000);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('omits clock_hz when there is no usable clock', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'x', clock_hz: null }));
    vi.stubGlobal('fetch', fetchMock);
    await enableFpgaDesign('/api/board/fpga-1', 'x', 0);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('does not double the slash when apiBase has a trailing one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: null, designs: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await loadFpgaDesigns('/api/board/fpga-1/');
    expect(fetchMock).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
  });
});
