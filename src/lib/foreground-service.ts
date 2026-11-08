// [INPUT]: the native module surface (start/update/stop plus battery-optimization helpers) as raw functions.
// [OUTPUT]: createForegroundService(native) → { start, update, stop, isIgnoringBatteryOptimizations,
//           openIgnoreBatteryOptimizations }; NativeForegroundService / ForegroundService /
//           KeepAliveStatus types.
// [POS]: Typed seam over the keep-alive native module (modules/solco-foreground-service). The hold's
//        ongoing notification is the agent status line: `start(status)` raises it, `update(status)`
//        re-posts its text (a notify, allowed from the background). `start` logs and swallows the
//        Android 12+ "foreground service from background" refusal — the hold is best effort; the
//        sockets keep working until the process actually dies, which is the documented free-path
//        boundary. Pure TS, tested with a fake.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

/** What the ongoing notification says: the title line and the one status line under it. */
export interface KeepAliveStatus {
  title: string;
  text: string;
}

export interface NativeForegroundService {
  start(title: string, text: string): void;
  update(title: string, text: string): boolean;
  stop(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openIgnoreBatteryOptimizations(): void;
}

export interface ForegroundService {
  start(status: KeepAliveStatus): void;
  update(status: KeepAliveStatus): void;
  stop(): void;
  isIgnoringBatteryOptimizations(): boolean;
  openIgnoreBatteryOptimizations(): void;
}

export function createForegroundService(native: NativeForegroundService): ForegroundService {
  return {
    start(status) {
      try {
        native.start(status.title, status.text);
      } catch (error) {
        // Android 12+ refuses FGS starts issued from the background. There is no retry loop: the
        // next app-state change tries again, and a dropped hold only ends delivery once the system
        // reaps the process.
        console.log(`[fgs] start refused: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    update(status) {
      try {
        native.update(status.title, status.text);
      } catch (error) {
        console.log(`[fgs] update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    stop() {
      native.stop();
    },
    isIgnoringBatteryOptimizations: () => native.isIgnoringBatteryOptimizations(),
    openIgnoreBatteryOptimizations: () => native.openIgnoreBatteryOptimizations(),
  };
}
