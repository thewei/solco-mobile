// [INPUT]: a terminal id (+ instance, title) from Chat's menu or the Workspace page and the Go Host v3 terminal stream.
// [OUTPUT]: The terminal page (designs/mobile-t3-redesign `terminal`): a `Screen` bar ("Terminal", the Workspace + who holds the grid as
//           subtitle, a ⋮ menu: Terminals / Font & theme / History / Open changes / Copy output / Reconnect / Give back to the Mac),
//           the libghostty grid, one key row (Esc Tab Ctrl Alt ^C arrows Home End PgUp PgDn, Fn = F1-F12, symbols), a bookmark
//           (Snippets) + growing line composer + Send, a Latest pill while scrolled back, a Connecting… face, and Banners for a dropped
//           stream (Reconnect), the Mac taking the terminal back (Take over) and a terminal that is gone (4404).
//           With capability terminalControl the terminal opens already taken over (mode=control, 2026-11-07 user decision): the PTY
//           follows the phone's grid and scrolling is the controller's (Android: patched view reports lines; iOS: the rail).
//           The Mac taking it back or a late reconnect falls back to watching; the key row and composer then stay hidden until Take over.
// [POS]: Terminal surface. Herdr's observer is only a top-left window onto the Mac pane's own screen (no reflow, no
//        cursor follow), so while only watching on Android — once the Host's `pane` message names the Mac pane's grid — the view pins
//        its grid to it and pans over it (patched expo-libghostty `fixedGrid`); in a takeover the phone owns its grid, so a keyboard
//        change just restarts the stream with a full first frame (resize debounced 250 ms). Reconnects with a capped backoff; a 4404
//        close ends the session. Safe area and keyboard ride the shared safe-area-context SafeAreaView + KeyboardInset.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { KeyboardInset } from '@/components/keyboard-inset';
import { Menu, MenuItem, MenuRule } from '@/components/menu';
import { PillButton } from '@/components/pill-button';
import { Screen } from '@/components/screen';
import { useToast } from '@/components/toast';
import type { NativeTerminalHandle } from '@/components/ghostty-terminal';
import { PageScrollRail } from '@/components/page-scroll-rail';
import { TerminalKeyRow } from '@/components/terminal-key-row';
import { TerminalSnippetsSheet } from '@/components/terminal-snippets-sheet';
import { TerminalStyleSheet } from '@/components/terminal-style-sheet';
import { TerminalSwitchSheet } from '@/components/terminal-switch-sheet';
import { workspaceOfTerminal } from '@/features/host/git-model';
import { flattenPanes, paneRoute, type FlatPane } from '@/features/host/pane-model';
import { useGitStatus, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { historyFailure } from '@/features/host/terminal-history-model';
import type { TerminalSession } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { PAGE_DOWN, PAGE_UP } from '@/lib/page-keys';
import { adoptPaneGrid } from '@/lib/pane-grid';
import { composeTyped, ignoresMods, keyInput } from '@/lib/terminal-keys';
import { clampFontSize, DEFAULT_PREFS, snapshotTheme, TERMINAL_THEMES, type TerminalThemeName } from '@/lib/terminal-prefs';
import { loadPrefs, readBlob, savePrefs, writeBlob } from '@/lib/terminal-prefs-storage';
import { addSnippet, getRecent, parseSnippets, removeSnippet, rememberLine, serializeSnippets, type Snippet } from '@/lib/terminal-snippets';
import { IconArrowDown, IconBookmark, IconDotsVertical, IconLoader2, IconSend, IconTerminal2 } from '@/theme/glyphs';
import { colors, metrics, type as typeScale } from '@/theme/tokens';

// The renderer is native-only (expo-libghostty) — never in web bundles.
const LazyGhosttyTerminal = Platform.OS !== 'web'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require('@/components/ghostty-terminal').default as typeof import('@/components/ghostty-terminal').default
  : null;

const RESIZE_DEBOUNCE_MS = 250;
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 8_000;
const TAKEOVER_FIT_MS = 400;
const SEND_DEBOUNCE_MS = 120;
// A dropped takeover reconnects as a takeover (every retry of the normal backoff) only within this long after the
// drop: later, the Mac user may have taken the terminal back on purpose, so it settles for observing.
const CONTROL_RESUME_WINDOW_MS = 20_000;

type Phase = 'connecting' | 'live' | 'reconnecting' | 'gone';

export default function TerminalScreen() {
  const router = useRouter();
  const { client, connection } = useHostV3();
  const { bootstrap } = useHostInstance();
  const params = useLocalSearchParams<{ terminalId: string; instance?: string; title?: string }>();
  const terminalId = Array.isArray(params.terminalId) ? params.terminalId[0] : params.terminalId;
  const instance = (Array.isArray(params.instance) ? params.instance[0] : params.instance) ?? '';
  const paramTitle = (Array.isArray(params.title) ? params.title[0] : params.title) ?? '';
  const { toast, show } = useToast();

  const terminalRef = useRef<NativeTerminalHandle>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const gridRef = useRef<{ cols: number; rows: number } | null>(null);
  // The grid the running stream was opened/restarted at, and the Mac pane's grid once the Host reports it (Android pins the view to it).
  const openedGrid = useRef<{ cols: number; rows: number } | null>(null);
  const [paneGrid, setPaneGrid] = useState<{ cols: number; rows: number } | null>(null);
  const paneGridRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempts = useRef(0);
  // 'control' only between an explicit Take over and the next close/give back; the stream opens in whichever mode this says.
  const modeRef = useRef<'observe' | 'control'>('observe');
  // Set by Take over until the view reports the fitted grid the controller should take (see takeOver).
  const takeoverWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controlDroppedAt = useRef<number | null>(null);
  const [controlling, setControlling] = useState(false);
  // Opening a terminal takes it over (the PTY follows the phone's width, scrolling is Herdr's) when the Host can.
  const autoControlTried = useRef(false);
  const canControlRef = useRef(false);
  canControlRef.current = bootstrap.data?.capabilities.terminalControl === true;
  const stopped = useRef(false);
  // Bumped by every open; a closed session's late callbacks (resize restart, a newer open) are ignored.
  const generation = useRef(0);

  const [phase, setPhase] = useState<Phase>('connecting');
  // True from the Mac taking the terminal back until this phone takes it over again (names the banner).
  const [macTookBack, setMacTookBack] = useState(false);
  const [draft, setDraft] = useState('');
  // Takeover mouse mode (key row ‘Mouse’): one finger drives the program's mouse instead of scrolling.
  const [mouseMode, setMouseMode] = useState(false);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);
  const [atLive, setAtLive] = useState(true);
  // Font size and color theme are remembered across opens; the first render waits for the stored values. `prefs.fontSize`
  // is what the view is told; a pinch moves the native size on its own, so it only updates `liveFont` (what the menu shows
  // and what is saved) and never re-sets the prop mid-gesture.
  const [prefs, setPrefs] = useState<{ fontSize: number; theme: TerminalThemeName } | null>(null);
  const liveFont = useRef(DEFAULT_PREFS.fontSize);
  const themeRef = useRef<TerminalThemeName>(DEFAULT_PREFS.theme);
  const fontSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  useEffect(() => {
    let alive = true;
    void loadPrefs().then((loaded) => {
      if (!alive) return;
      liveFont.current = loaded.fontSize;
      themeRef.current = loaded.theme;
      setPrefs(loaded);
    });
    void readBlob('snippets').then((raw) => alive && setSnippets(parseSnippets(raw)));
    return () => {
      alive = false;
      clearTimeout(fontSaveTimer.current);
    };
  }, []);
  const persistPrefs = useCallback(() => {
    clearTimeout(fontSaveTimer.current);
    fontSaveTimer.current = setTimeout(() => void savePrefs({ fontSize: liveFont.current, theme: themeRef.current }), 400);
  }, []);
  const onFontSize = useCallback(
    (size: number) => {
      liveFont.current = size;
      persistPrefs();
    },
    [persistPrefs],
  );
  const setFontFromMenu = (size: number) => {
    const next = clampFontSize(size);
    liveFont.current = next;
    setPrefs((p) => (p ? { ...p, fontSize: next } : p));
    persistPrefs();
  };
  const setThemeFromMenu = (name: TerminalThemeName) => {
    themeRef.current = name;
    setPrefs((p) => (p ? { ...p, theme: name } : p));
    persistPrefs();
  };
  const updateSnippets = (next: Snippet[]) => {
    setSnippets(next);
    void writeBlob('snippets', serializeSnippets(next));
  };
  const tree = useTreeV3(instance || null);
  const panes = tree.data ? flattenPanes(tree.data.workspaces) : [];
  const workspace = workspaceOfTerminal(tree.data?.workspaces ?? [], terminalId ?? '');
  const workspaceLabel = workspace?.label ?? paramTitle;
  const hostName = connection?.name || bootstrap.data?.hostName || 'the computer';
  const switchTo = (item: FlatPane) => {
    setSwitchOpen(false);
    router.replace(paneRoute(item.pane, instance, bootstrap.data?.capabilities.chat === true));
  };

  // The reconnect timer fires later: it must open with the client of that moment, not the one it was armed with.
  const openRef = useRef<() => void>(() => undefined);
  const open = useCallback(() => {
    const grid = gridRef.current;
    if (!client || !terminalId || !grid || stopped.current) return;
    if (!autoControlTried.current && canControlRef.current) {
      autoControlTried.current = true;
      modeRef.current = 'control';
    }
    if (modeRef.current === 'control' && controlDroppedAt.current !== null && Date.now() - controlDroppedAt.current > CONTROL_RESUME_WINDOW_MS) {
      modeRef.current = 'observe';
      controlDroppedAt.current = null;
      show('Phone control ended; watching instead.');
    }
    sessionRef.current?.close();
    const mine = ++generation.current;
    openedGrid.current = grid;
    sessionRef.current = client.openTerminal(instance, terminalId, grid, {
      onEvent(event) {
        if (mine !== generation.current) return;
        if (event.kind === 'control') {
          setControlling(event.on);
          if (!event.on) {
            modeRef.current = 'observe';
            if (event.reason === 'taken_over') setMacTookBack(true);
          }
        } else if (event.kind === 'pane') {
          const decision = adoptPaneGrid(Platform.OS, openedGrid.current, { cols: event.cols, rows: event.rows });
          if (!decision.fixed) return;
          paneGridRef.current = decision.fixed;
          gridRef.current = decision.fixed;
          clearTimeout(resizeTimer.current); // a debounced fit-resize armed before the pane grid was known must not undo it
          setPaneGrid(decision.fixed);
          if (decision.resize) {
            openedGrid.current = decision.fixed;
            sessionRef.current?.resize(decision.fixed);
          }
        } else if (event.kind === 'frame') {
          attempts.current = 0;
          controlDroppedAt.current = null;
          setPhase('live');
          terminalRef.current?.write(event.frame.bytes, { full: event.frame.full });
        } else if (event.kind === 'input-error') {
          show(event.message ?? (event.code === 'refused' ? 'That input was refused.' : 'Input was not accepted.'));
        }
      },
      onClose({ gone }) {
        if (mine !== generation.current) return;
        sessionRef.current = null;
        if (stopped.current) return;
        // The Host releases a controller when its socket closes. A drop while the user held control (not the Mac
        // taking it back, not Give back — both set observe first) resumes control; open() settles for observing once the window passes.
        setControlling(false);
        if (modeRef.current === 'control') controlDroppedAt.current ??= Date.now();
        if (gone) modeRef.current = 'observe';
        if (gone) {
          setPhase('gone');
          return;
        }
        setPhase('reconnecting');
        attempts.current += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts.current - 1), RECONNECT_CAP_MS);
        reconnectTimer.current = setTimeout(() => openRef.current(), delay);
      },
    }, { control: modeRef.current === 'control' });
  }, [client, instance, terminalId, show]);
  openRef.current = open;

  // Take over: drop the Mac-pane pin so the view fits the phone, then open a control stream at that fitted grid.
  const takeOver = useCallback(() => {
    setMacTookBack(false);
    modeRef.current = 'control';
    paneGridRef.current = null;
    setPaneGrid(null);
    clearTimeout(resizeTimer.current);
    clearTimeout(takeoverWait.current);
    // onResize opens it as soon as the view reports the fitted grid; this is the fallback when the fit did not change.
    takeoverWait.current = setTimeout(() => {
      takeoverWait.current = undefined;
      const fitted = terminalRef.current?.getGeometry();
      if (fitted) gridRef.current = fitted;
      open();
    }, TAKEOVER_FIT_MS);
  }, [open]);
  // A cold start (deep link) can open the stream before the capabilities arrive: take over as soon as they say so.
  const canControl = bootstrap.data?.capabilities.terminalControl === true;
  useEffect(() => {
    if (!canControl || autoControlTried.current || !gridRef.current) return;
    autoControlTried.current = true;
    takeOver();
  }, [canControl, takeOver]);
  const giveBack = () => {
    modeRef.current = 'observe';
    clearTimeout(takeoverWait.current);
    takeoverWait.current = undefined;
    setControlling(false);
    open(); // closes the control stream (the Host restores the Mac's size) and observes again
  };

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      clearTimeout(resizeTimer.current);
      clearTimeout(reconnectTimer.current);
      clearTimeout(takeoverWait.current);
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  // The renderer reports its fitted grid on ready and on every layout change (keyboard, rotation).
  const onResize = useCallback(
    (cols: number, rows: number) => {
      // Pinned to the Mac pane's grid: the view's own fit no longer drives the stream.
      if (paneGridRef.current) return;
      const first = gridRef.current === null;
      gridRef.current = { cols, rows };
      if (takeoverWait.current) {
        clearTimeout(takeoverWait.current);
        takeoverWait.current = undefined;
        open();
        return;
      }
      if (first) {
        open();
        return;
      }
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => sessionRef.current?.resize(paneGridRef.current ?? { cols, rows }), RESIZE_DEBOUNCE_MS);
    },
    [open],
  );

  const mouseEvent = useCallback((action: 'down' | 'drag' | 'up', col: number, row: number) => {
    sessionRef.current?.mouse(action, col, row);
  }, []);
  useEffect(() => {
    if (!controlling) setMouseMode(false);
  }, [controlling]);
  const tapCell = useCallback((col: number, row: number) => {
    sessionRef.current?.tap(col, row);
  }, []);
  const scrollLines = useCallback((lines: number) => {
    sessionRef.current?.scroll(lines);
  }, []);
  const sendPage = (direction: 'up' | 'down') => {
    sessionRef.current?.sendInput({ text: direction === 'up' ? PAGE_UP : PAGE_DOWN });
  };
  const sendKey = (key: string) => {
    const input = keyInput(key, { ctrl: ctrlArmed, alt: altArmed });
    // Esc/Tab/^C, the paging literals and F-keys ignore the sticky modifiers, so they stay armed for the next real key.
    if (!ignoresMods(key)) {
      setCtrlArmed(false);
      setAltArmed(false);
    }
    sessionRef.current?.sendInput(input);
  };
  const toggleMod = (mod: 'ctrl' | 'alt') => (mod === 'ctrl' ? setCtrlArmed((on) => !on) : setAltArmed((on) => !on));
  // A multiline field submits from both the Enter key event and the IME action on some keyboards: one tap sends once.
  const lastSendAt = useRef(0);
  const sendLine = () => {
    const now = Date.now();
    if (now - lastSendAt.current < SEND_DEBOUNCE_MS) return;
    lastSendAt.current = now;
    setCtrlArmed(false);
    setAltArmed(false);
    if (!draft) {
      sessionRef.current?.sendInput({ keys: ['enter'] });
      return;
    }
    const sent = sessionRef.current?.sendInput({ text: draft, keys: ['enter'] });
    if (sent === false) show('That line is too long to send.');
    else {
      rememberLine(draft);
      setDraft('');
    }
  };
  const runLine = (text: string) => {
    setSnippetsOpen(false);
    if (sessionRef.current?.sendInput({ text, keys: ['enter'] }) === false) show('That line is too long to send.');
    else rememberLine(text);
  };

  const keyRow = (
    <TerminalKeyRow
      ctrlArmed={ctrlArmed}
      altArmed={altArmed}
      onToggleMod={toggleMod}
      onKey={sendKey}
      mouse={controlling && Platform.OS === 'android' ? { armed: mouseMode, onToggle: () => setMouseMode((on) => !on) } : undefined}
    />
  );
  const hasText = draft.trim() !== '';
  const composer = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Snippets"
        onPress={() => setSnippetsOpen(true)}
        style={({ pressed }) => ({ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.navIndicator : 'transparent' })}>
        <Icon as={IconBookmark} size="lg" tone="muted" />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, borderRadius: 24, backgroundColor: colors.composer, borderWidth: 1, borderColor: colors.composerBorder, paddingHorizontal: 14 }}>
        <TextInput
          accessibilityLabel="Type a line"
          value={draft}
          onChangeText={(text) => setDraft(text.replace(/[\r\n]+/g, ' '))}
          onSubmitEditing={sendLine}
          multiline
          submitBehavior="submit"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Type a line, then send"
          placeholderTextColor={colors.textMuted}
          returnKeyType="send"
          style={{ minHeight: 46, maxHeight: 116, paddingVertical: 11.5, color: colors.text, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send line"
        onPress={sendLine}
        style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: hasText ? colors.accent : colors.accentDim }}>
        <Icon as={IconSend} size="lg" tone="onAccent" />
      </Pressable>
    </>
  );

  const Terminal = LazyGhosttyTerminal;
  const gone = phase === 'gone';
  // Only a Host that can hand out control watches read-only after losing it; one that cannot (the resident Host) keeps typing on its observe stream.
  const watching = canControl && !controlling && phase === 'live';
  // The design's dropped-stream page is the banner over the output: keys and composer return with the live stream.
  const typing = phase === 'live' && !watching;
  const themeName = prefs?.theme ?? DEFAULT_PREFS.theme;
  const theme = useMemo(() => snapshotTheme(TERMINAL_THEMES[themeName]), [themeName]);

  const reviewWorkspace = bootstrap.data?.capabilities.git === true ? workspace : null;
  const changes = useGitStatus(instance, reviewWorkspace?.id ?? '', reviewWorkspace !== null);
  const changedCount = changes.data?.repo ? changes.data.files.length : undefined;

  const reconnect = () => {
    setMenuOpen(false);
    clearTimeout(reconnectTimer.current);
    attempts.current = 0;
    open();
  };
  // Copy output = the Host's retained history text (the libghostty view cannot hand its screen back); only where the Host serves it.
  const copyOutput = async () => {
    setMenuOpen(false);
    try {
      const history = await client?.terminalHistory(instance, terminalId ?? '');
      if (!history?.text) return show('Nothing to copy');
      await Clipboard.setStringAsync(history.text);
      show('Output copied');
    } catch (error) {
      show(historyFailure(error));
    }
  };
  const later = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <Screen
      back
      title="Terminal"
      subtitle={[workspaceLabel, controlling ? 'on this phone' : watching ? 'watching the Mac' : ''].filter(Boolean).join(' · ') || undefined}
      actions={[{ icon: IconDotsVertical, label: 'More', onPress: () => setMenuOpen(true) }]}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.chrome }}>
        <KeyboardInset>
          {phase === 'reconnecting' ? <Banner tone="bad" text="Terminal disconnected. The Mac may have gone to sleep." action="Reconnect" onAction={reconnect} /> : null}
          {watching ? <Banner text={macTookBack ? 'The Mac took this terminal back.' : 'Watching the Mac. Take over to type here.'} action="Take over" onAction={takeOver} /> : null}
          <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 12, paddingHorizontal: 14 }}>
            {Terminal && prefs !== null ? (
              <Terminal
                ref={terminalRef}
                fontSize={prefs.fontSize}
                themeColors={theme}
                onFontSize={onFontSize}
                onInput={(data) => {
                  const chord = composeTyped(data, { ctrl: ctrlArmed, alt: altArmed });
                  if (chord) {
                    setCtrlArmed(false);
                    setAltArmed(false);
                  }
                  sessionRef.current?.sendInput(chord ?? { text: data });
                }}
                onResize={onResize}
                fixedGrid={paneGrid}
                onScrollLines={controlling ? scrollLines : null}
                onTap={controlling ? tapCell : null}
                onMouse={controlling && mouseMode ? mouseEvent : null}
                onScrollBottom={setAtLive}
              />
            ) : null}
            {Platform.OS === 'ios' && !gone ? <PageScrollRail onPage={sendPage} onLines={controlling ? scrollLines : undefined} /> : null}
            {!atLive && phase !== 'connecting' ? (
              <View style={{ position: 'absolute', bottom: 12, right: 12 }}>
                <PillButton
                  compact
                  tone="soft"
                  icon={IconArrowDown}
                  label="Latest"
                  accessibilityLabel="Jump to latest"
                  onPress={() => {
                    setAtLive(true);
                    terminalRef.current?.toLive();
                  }}
                />
              </View>
            ) : null}
          </View>

          {/* Keys and the line field only while this phone can type: the design's disconnected / watching page is the banner over the output. */}
          {typing ? (
            <>
              <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.chrome }}>{keyRow}</View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, backgroundColor: colors.chrome }}>{composer}</View>
            </>
          ) : null}
        </KeyboardInset>
      </SafeAreaView>
      {/* A closed terminal is the design's `gone` page: an empty card with the way back. */}
      {gone ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas }]}>
          <EmptyState icon={IconTerminal2} title="This terminal no longer exists" text="It was closed on the Mac." action="Back to list" onAction={() => router.back()} />
        </View>
      ) : null}
      {/* Over the whole card, not the safe-area body: the design centres "Connecting…" on the card. */}
      {phase === 'connecting' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas }]}>
          <EmptyState spin icon={IconLoader2} title="Connecting…" text={`Opening the terminal on ${hostName}.`} />
        </View>
      ) : null}
      {toast}
      <Menu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <MenuItem label="Terminals" detail={panes.length > 0 ? String(panes.length) : undefined} onPress={later(() => setSwitchOpen(true))} />
        <MenuItem label="Font & theme" onPress={later(() => setStyleOpen(true))} />
        {bootstrap.data?.capabilities.terminalHistory === true ? (
          <MenuItem label="History" onPress={later(() => router.push({ pathname: '/terminal/history', params: { terminalId: terminalId ?? '', instance, title: workspaceLabel } }))} />
        ) : null}
        {reviewWorkspace ? (
          <MenuItem
            label="Open changes"
            detail={changedCount ? `${changedCount} ${changedCount === 1 ? 'file' : 'files'}` : undefined}
            onPress={later(() => router.push({ pathname: '/changes/[workspaceId]', params: { workspaceId: reviewWorkspace.id, instance, title: reviewWorkspace.label } }))}
          />
        ) : null}
        <MenuRule />
        {bootstrap.data?.capabilities.terminalHistory === true ? <MenuItem label="Copy output" onPress={() => void copyOutput()} /> : null}
        <MenuItem label="Reconnect" onPress={reconnect} />
        {canControl && phase === 'live' ? (
          controlling ? <MenuItem label="Give back to the Mac" onPress={later(giveBack)} /> : <MenuItem label="Take over on this phone" onPress={later(takeOver)} />
        ) : null}
      </Menu>
      <TerminalSwitchSheet visible={switchOpen} onClose={() => setSwitchOpen(false)} panes={panes} currentTerminalId={terminalId ?? ''} onSwitch={switchTo} />
      <TerminalStyleSheet
        visible={styleOpen}
        onClose={() => setStyleOpen(false)}
        fontSize={Math.round(liveFont.current)}
        onFontSize={setFontFromMenu}
        theme={prefs?.theme ?? DEFAULT_PREFS.theme}
        onTheme={setThemeFromMenu}
      />
      <TerminalSnippetsSheet
        visible={snippetsOpen}
        onClose={() => setSnippetsOpen(false)}
        snippets={snippets}
        recent={getRecent()}
        draft={draft}
        onPick={(text) => {
          setDraft(text);
          setSnippetsOpen(false);
        }}
        onRun={runLine}
        onSave={(text) => updateSnippets(addSnippet(snippets, text, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`))}
        onRemove={(id) => updateSnippets(removeSnippet(snippets, id))}
      />
    </Screen>
  );
}
