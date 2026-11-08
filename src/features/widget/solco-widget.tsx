'use no memo';
// [INPUT]: a WidgetState (unpaired / offline / ready with counts + rows) and the widget's height in dp.
// [OUTPUT]: <SolcoWidget/> — the count bar and the most urgent agents, drawn with react-native-android-widget
//           primitives (native RemoteViews, not React Native views).
// [POS]: View of the home-screen widget, colors from theme/tokens' palette for the scheme it is handed (the widget has no React tree, so it never reads the live `colors`). Tapping a row opens that agent's Chat
//        (OPEN_URI), the refresh glyph asks the headless task for a fresh read (REFRESH), anything else opens the app.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// The file opts out of the React Compiler on purpose: the widget tree is built by calling these functions
// directly (no renderer), so compiler memo hooks would throw "Invalid hook call". No hooks here, ever.
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { palettes, type Scheme } from '@/theme/tokens';
import { visibleRows, type WidgetRow, type WidgetState } from '@/features/widget/widget-model';

/** The click action the headless task answers with a fresh read. */
export const REFRESH_ACTION = 'REFRESH';

type Hex = `#${string}`;
/** The widget's palette: only the opaque hex roles RemoteViews can draw. */
const hexOf = (scheme: Scheme) => {
  const c = palettes[scheme];
  return { text: c.text as Hex, muted: c.textMuted as Hex, subtle: c.textSubtle as Hex, canvas: c.canvas as Hex, attention: c.attention as Hex, accentText: c.accentText as Hex };
};
type WidgetColors = ReturnType<typeof hexOf>;

const dotOf = (c: WidgetColors): Record<WidgetRow['status'], { glyph: string; color: Hex }> => ({
  blocked: { glyph: '●', color: c.attention },
  working: { glyph: '●', color: c.accentText },
  idle: { glyph: '○', color: c.muted },
});

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Count({ value, label, color, c }: { value: number; label: string; color: Hex; c: WidgetColors }) {
  return <TextWidget text={`${value} ${label}`} style={{ fontSize: 12, fontWeight: '600', color: value > 0 ? color : c.subtle, marginRight: 10 }} />;
}

function Refresh({ c }: { c: WidgetColors }) {
  return <TextWidget text="↻" clickAction={REFRESH_ACTION} accessibilityLabel="Refresh" style={{ fontSize: 16, color: c.muted, paddingHorizontal: 6 }} />;
}

function Row({ row, c }: { row: WidgetRow; c: WidgetColors }) {
  const dot = dotOf(c)[row.status];
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: row.uri }}
      style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 32 }}
    >
      <TextWidget text={dot.glyph} style={{ fontSize: 12, color: dot.color, width: 18 }} />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={row.title} truncate="END" maxLines={1} style={{ fontSize: 13, color: c.text }} />
      </FlexWidget>
      <TextWidget text={clip(row.caption, 12)} maxLines={1} style={{ fontSize: 11, color: c.subtle, marginLeft: 8 }} />
    </FlexWidget>
  );
}

function Message({ text, action, c }: { text: string; action: 'OPEN_APP' | typeof REFRESH_ACTION; c: WidgetColors }) {
  return (
    <FlexWidget clickAction={action} style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
      <TextWidget text={text} style={{ fontSize: 13, color: c.muted }} />
    </FlexWidget>
  );
}

export function SolcoWidget({ state, heightDp, scheme }: { state: WidgetState; heightDp?: number; scheme: Scheme }) {
  const c = hexOf(scheme);
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: c.canvas,
        borderRadius: 18,
        padding: 12,
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 28 }}>
        {state.kind === 'ready' ? (
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Count value={state.data.needsYou} label="needs you" color={c.attention} c={c} />
            <Count value={state.data.working} label="working" color={c.accentText} c={c} />
            <Count value={state.data.idle} label="idle" color={c.muted} c={c} />
          </FlexWidget>
        ) : (
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text="Solco" style={{ fontSize: 12, fontWeight: '600', color: c.muted }} />
          </FlexWidget>
        )}
        {state.kind === 'unpaired' ? null : <Refresh c={c} />}
      </FlexWidget>
      {state.kind === 'unpaired' ? (
        <Message text="Open Solco to pair your computer" action="OPEN_APP" c={c} />
      ) : state.kind === 'offline' ? (
        <Message text="Can’t reach your computer. Tap ↻ to retry" action={REFRESH_ACTION} c={c} />
      ) : state.data.rows.length === 0 ? (
        <Message text="No agents running" action="OPEN_APP" c={c} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 4 }}>
          {state.data.rows.slice(0, visibleRows(heightDp)).map((row) => (
            <Row key={row.paneId} row={row} c={c} />
          ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
