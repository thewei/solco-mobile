// [INPUT]: nothing at call time; imported once for its side effect by index.ts.
// [OUTPUT]: on Android, registers the headless task `SolcoKeepAlive` (KEEP_ALIVE_TASK).
// [POS]: React Native pauses every JS timer (setTimeout/setInterval) once the Activity is backgrounded,
//        unless a headless JS task is running. TanStack Query schedules its observer notifications with
//        setTimeout, and the events socket's reconnect backoff and silence watchdog are timers too, so
//        in the background a tree refetched by an event never reached the notification effect. The
//        native keep-alive hold (SolcoForegroundServiceModule.start) starts this task, which never
//        resolves, for as long as the phone is paired; that keeps the timers running. It does no work.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { AppRegistry, Platform } from 'react-native';

export const KEEP_ALIVE_TASK = 'SolcoKeepAlive';

/** Never settles on purpose: the task's lifetime is the hold on the JS timers. */
export const keepAliveTask = () => new Promise<void>(() => undefined);

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK, () => keepAliveTask);
}
