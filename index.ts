// [INPUT]: the app bundle entry (package.json `main`).
// [OUTPUT]: expo-router's entry, plus the Android headless tasks (widget updates, the keep-alive timer hold).
// [POS]: Replaces `main: expo-router/entry` because a headless widget update runs JS with no React tree,
//        so its handler must be registered at bundle load, before any screen mounts.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import 'expo-router/entry';
import '@/features/widget/register';
import '@/features/host/keep-alive-task';
