// [INPUT]: the library's widget actions (added / update / resized / click / deleted), delivered to headless JS.
// [OUTPUT]: widgetTaskHandler — draws the widget from a fresh loadWidgetState().
// [POS]: Registered once in index.ts (android only). Runs with no React tree, possibly in a process the user
//        never opened: the system's 30-minute update, a resize, a first placement and the ↻ tap all end here.
//        A row tap is an OPEN_URI deep link handled natively, so it never reaches this handler.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Appearance } from 'react-native';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { loadAppearance } from '@/lib/appearance-storage';
import { resolveScheme } from '@/lib/appearance';
import { loadWidgetState } from '@/features/widget/widget-load';
import { REFRESH_ACTION, SolcoWidget } from '@/features/widget/solco-widget';
import { WIDGET_NAME } from '@/features/widget/widget-model';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  if (props.widgetAction === 'WIDGET_DELETED') return;
  // Only the refresh glyph is a click this handler owns.
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction !== REFRESH_ACTION) return;
  // No React tree and maybe no app process: the person's choice is read from its file, the system scheme from the OS.
  const scheme = resolveScheme(await loadAppearance(), Appearance.getColorScheme());
  props.renderWidget(<SolcoWidget state={await loadWidgetState()} heightDp={props.widgetInfo.height} scheme={scheme} />);
}
