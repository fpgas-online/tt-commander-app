import { afterEach, describe, expect, it, vi } from 'vitest';
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
