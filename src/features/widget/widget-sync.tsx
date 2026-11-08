// [INPUT]: the workspaces the running app already holds (the shared tree query, kept fresh by the events socket).
// [OUTPUT]: pushWidgetUpdate — redraws every placed widget from that tree, with no network read.
// [POS]: The "live while the app runs" half of the widget's refresh policy (the system's 30-minute tick and the ↻
//        tap are the headless task's). Called from BackgroundBridge on tree changes; coalesced to one draw per
//        window so a burst of events costs one RemoteViews update. Android only; a no-op elsewhere.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Platform } from 'react-native';

import type { TreeWorkspace } from '@/contracts/host-v3';
import { activeScheme } from '@/theme/tokens';
import { buildWidgetData, WIDGET_NAME, type WidgetData } from '@/features/widget/widget-model';

const MIN_GAP_MS = 4_000;

let lastDrawAt = 0;
let lastKey = '';
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: WidgetData | null = null;

async function draw(data: WidgetData, now: number): Promise<void> {
  lastDrawAt = now;
  // Loaded on demand: a build without the native widget module (an older dev client) fails here, quietly.
  const [{ requestWidgetUpdate }, { SolcoWidget }] = await Promise.all([import('react-native-android-widget'), import('@/features/widget/solco-widget')]);
  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: (info) => <SolcoWidget state={{ kind: 'ready', data, at: now }} heightDp={info.height} scheme={activeScheme()} />,
  });
}

/** Same rows, counts and order as the last draw → nothing to do. */
const keyOf = (data: WidgetData) => JSON.stringify([data.needsYou, data.working, data.idle, data.rows.map((row) => [row.paneId, row.status, row.title, row.caption])]);

export function pushWidgetUpdate(workspaces: readonly TreeWorkspace[], instance: string, chatServed: boolean, now: number = Date.now()): void {
  if (Platform.OS !== 'android') return;
  const data = buildWidgetData(workspaces, instance, chatServed);
  const key = keyOf(data);
  if (key === lastKey) return;
  lastKey = key;
  pending = data;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (next) void draw(next, Date.now()).catch(() => undefined);
  }, Math.max(0, MIN_GAP_MS - (now - lastDrawAt)));
}
