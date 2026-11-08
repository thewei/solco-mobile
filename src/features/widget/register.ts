// [INPUT]: nothing at call time; imported once for its side effect by index.ts.
// [OUTPUT]: on Android, registers widgetTaskHandler as the headless task the widget's updates and taps run.
// [POS]: The one place the widget task is wired. Android only, and tolerant of a build that predates the
//        native widget module (the require throws; the app then simply has no widget until it is rebuilt).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- loaded lazily so a binary without the native module still boots */
    const { registerWidgetTaskHandler } = require('react-native-android-widget') as typeof import('react-native-android-widget');
    const { widgetTaskHandler } = require('@/features/widget/task-handler') as typeof import('@/features/widget/task-handler');
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch {
    // No native widget module in this binary.
  }
}
