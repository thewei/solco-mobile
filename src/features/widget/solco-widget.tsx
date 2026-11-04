'use no memo';
// [INPUT]: a WidgetState (unpaired / offline / ready with counts + rows) and the widget's height in dp.
// [OUTPUT]: <SolcoWidget/> — the count bar and the most urgent agents, drawn with react-native-android-widget
//           primitives (native RemoteViews, not React Native views).
// [POS]: View of the home-screen widget, colors from theme/tokens. Tapping a row opens that agent's Chat
//        (OPEN_URI), the refresh glyph asks the headless task for a fresh read (REFRESH), anything else opens the app.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// The file opts out of the React Compiler on purpose: the widget tree is built by calling these functions
// directly (no renderer), so compiler memo hooks would throw "Invalid hook call". No hooks here, ever.
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { colors } from '@/theme/tokens';
import { visibleRows, type WidgetRow, type WidgetState } from '@/features/widget/widget-model';

/** The click action the headless task answers with a fresh read. */
export const REFRESH_ACTION = 'REFRESH';

const DOT: Record<WidgetRow['status'], { glyph: string; color: `#${string}` }> = {
  blocked: { glyph: '●', color: colors.attention },
  working: { glyph: '●', color: colors.accent },
  idle: { glyph: '○', color: colors.textMuted },
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Count({ value, label, color }: { value: number; label: string; color: `#${string}` }) {
  return <TextWidget text={`${value} ${label}`} style={{ fontSize: 12, fontWeight: '600', color: value > 0 ? color : colors.textSubtle, marginRight: 10 }} />;
}

function Refresh() {
  return <TextWidget text="↻" clickAction={REFRESH_ACTION} accessibilityLabel="Refresh" style={{ fontSize: 16, color: colors.textMuted, paddingHorizontal: 6 }} />;
}

function Row({ row }: { row: WidgetRow }) {
  const dot = DOT[row.status];
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: row.uri }}
      style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 32 }}
    >
      <TextWidget text={dot.glyph} style={{ fontSize: 12, color: dot.color, width: 18 }} />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={row.title} truncate="END" maxLines={1} style={{ fontSize: 13, color: colors.text }} />
      </FlexWidget>
      <TextWidget text={clip(row.caption, 12)} maxLines={1} style={{ fontSize: 11, color: colors.textSubtle, marginLeft: 8 }} />
    </FlexWidget>
  );
}

function Message({ text, action }: { text: string; action: 'OPEN_APP' | typeof REFRESH_ACTION }) {
  return (
    <FlexWidget clickAction={action} style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
      <TextWidget text={text} style={{ fontSize: 13, color: colors.textMuted }} />
    </FlexWidget>
  );
}

export function SolcoWidget({ state, heightDp }: { state: WidgetState; heightDp?: number }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: colors.canvas,
        borderRadius: 18,
        padding: 12,
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 28 }}>
        {state.kind === 'ready' ? (
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Count value={state.data.needsYou} label="needs you" color={colors.attention} />
            <Count value={state.data.working} label="working" color={colors.accent} />
            <Count value={state.data.idle} label="idle" color={colors.textMuted} />
          </FlexWidget>
        ) : (
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text="Solco" style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }} />
          </FlexWidget>
        )}
        {state.kind === 'unpaired' ? null : <Refresh />}
      </FlexWidget>
      {state.kind === 'unpaired' ? (
        <Message text="Open Solco to pair your computer" action="OPEN_APP" />
      ) : state.kind === 'offline' ? (
        <Message text="Can’t reach your computer. Tap ↻ to retry" action={REFRESH_ACTION} />
      ) : state.data.rows.length === 0 ? (
        <Message text="No agents running" action="OPEN_APP" />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 4 }}>
          {state.data.rows.slice(0, visibleRows(heightDp)).map((row) => (
            <Row key={row.paneId} row={row} />
          ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
