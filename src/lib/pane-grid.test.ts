import { describe, expect, it } from 'vitest';

import { adoptPaneGrid } from './pane-grid';

describe('adoptPaneGrid', () => {
  it('pins the view to the pane grid on Android and restarts a stream opened at another size', () => {
    expect(adoptPaneGrid('android', { cols: 53, rows: 40 }, { cols: 120, rows: 40 })).toEqual({ fixed: { cols: 120, rows: 40 }, resize: true });
  });

  it('does not restart a stream already at the pane grid (a reconnect opens there)', () => {
    expect(adoptPaneGrid('android', { cols: 120, rows: 40 }, { cols: 120, rows: 40 })).toEqual({ fixed: { cols: 120, rows: 40 }, resize: false });
  });

  it('restarts when the desktop resizes the pane', () => {
    expect(adoptPaneGrid('android', { cols: 120, rows: 40 }, { cols: 90, rows: 30 })).toEqual({ fixed: { cols: 90, rows: 30 }, resize: true });
  });

  it('clamps a pane larger than the stream allows', () => {
    expect(adoptPaneGrid('android', null, { cols: 900, rows: 500 })).toEqual({ fixed: { cols: 400, rows: 200 }, resize: true });
  });

  it('leaves iOS and web fitting their own view', () => {
    expect(adoptPaneGrid('ios', null, { cols: 120, rows: 40 })).toEqual({ fixed: null, resize: false });
    expect(adoptPaneGrid('web', null, { cols: 120, rows: 40 })).toEqual({ fixed: null, resize: false });
  });
});
