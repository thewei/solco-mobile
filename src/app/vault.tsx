// [INPUT]: the Host's Solco Vault view (GET /vault, needs `capabilities.vault`), its item names (GET /vault/items) and, on request, one value.
// [OUTPUT]: Vault — the Settings → Agents → Vault page: the secret approvals waiting for you (Allow once / Deny, never "always"),
//           the item and field names, and — only where the Mac's owner switched it on — a Show button per field that reads one
//           value, shows it for 30 s, and can copy it (the clipboard is emptied again after 30 s).
// [POS]: Third client of Solco Vault, the Mac app that owns every state and both switches (phone access, show values): offline,
//        switched off and locked are states this page draws, not errors. Names only until a Show press; the value is held in
//        component state alone (never a query cache, a store or a log) and dropped on hide, timeout, background and unmount.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Section } from '@/components/list-group';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import type { VaultApproval, VaultItem } from '@/contracts/host-v3';
import { useHostVault, useVaultAnswer, useVaultItems } from '@/features/host/queries-v3';
import { refLabel, REVEAL_HIDE_MS, standingLabel, vaultFailureMessage, vaultPhase } from '@/features/host/vault-model';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconChevronRight, IconKey, IconLock } from '@/theme/glyphs';
import { colors, spacing, type as typeScale } from '@/theme/tokens';

function ApprovalCard({ approval, busy, onAnswer }: { approval: VaultApproval; busy: boolean; onAnswer: (allow: boolean) => void }) {
  const what = approval.reveal ? 'wants to see a value' : 'wants to use secrets';
  return (
    <Card padded gap={8}>
      <Text color={approval.reveal ? colors.danger : colors.text} fontSize={14.5} fontWeight="700">
        {approval.project ? `${approval.project} ${what}` : `A command ${what}`}
      </Text>
      {approval.command ? <Text color={colors.textMuted} fontSize={12.5} lineHeight={18} selectable numberOfLines={3}>{approval.command}</Text> : null}
      {approval.refs.map((r) => (
        <XStack key={r.ref} justifyContent="space-between" gap={8}>
          <Text flex={1} color={colors.text} fontSize={13} numberOfLines={1}>{refLabel(r.ref)}</Text>
          <Text color={colors.textSubtle} fontSize={12}>{standingLabel(r.standing)}</Text>
        </XStack>
      ))}
      {approval.reveal ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>The Agent will see this value in plain text; it may reach its model provider.</Text> : null}
      <XStack gap={8}>
        <PillButton label="Allow once" compact disabled={busy} onPress={() => onAnswer(true)} />
        <PillButton label="Deny" tone="soft" compact disabled={busy} onPress={() => onAnswer(false)} />
      </XStack>
    </Card>
  );
}

/** One field of an opened item: its name and, when the Mac allows it, a Show button that holds the value for 30 s. */
function FieldRow({ path, field, canReveal }: { path: string; field: string; canReveal: boolean }) {
  const { client } = useHostV3();
  const [value, setValue] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef<string | null>(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    shown.current = null;
    setValue(null);
    setCopied(false);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') hide();
    });
    return () => sub.remove();
  }, [hide]);

  const show = async () => {
    if (!client) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await client.vaultReveal(`vault://${path}#${field}`);
      shown.current = next;
      setValue(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(hide, REVEAL_HIDE_MS);
    } catch (error) {
      setProblem(vaultFailureMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (value === null) return;
    const text = value;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    // Leave nothing behind: empty the clipboard again unless something else was copied meanwhile.
    setTimeout(() => {
      void Clipboard.getStringAsync()
        .then((now) => (now === text ? Clipboard.setStringAsync('') : undefined))
        .catch(() => undefined);
    }, REVEAL_HIDE_MS);
  };

  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 14, gap: 6 }}>
      <XStack alignItems="center" gap={8}>
        <Text flex={1} color={colors.text} fontSize={typeScale.body.fontSize}>{field}</Text>
        {canReveal && value === null ? <PillButton label="Show" tone="soft" compact disabled={busy} onPress={() => void show()} /> : null}
        {value !== null ? <PillButton label="Hide" tone="soft" compact onPress={hide} /> : null}
      </XStack>
      {value !== null ? (
        <XStack alignItems="center" gap={8}>
          <Text flex={1} color={colors.text} fontSize={14} selectable>{value}</Text>
          <PillButton label={copied ? 'Copied' : 'Copy'} compact onPress={() => void copy()} />
        </XStack>
      ) : null}
      {problem ? <Text color={colors.danger} fontSize={12.5}>{problem}</Text> : null}
    </View>
  );
}

function ItemRow({ item, open, onToggle, canReveal }: { item: VaultItem; open: boolean; onToggle: () => void; canReveal: boolean }) {
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.path}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 49, paddingVertical: 10.5, paddingHorizontal: 14, backgroundColor: pressed ? colors.skeleton : 'transparent' })}>
        <Icon as={IconKey} size="lg" tone="text" />
        <Text flex={1} color={colors.text} fontSize={typeScale.body.fontSize} numberOfLines={1}>{item.path}</Text>
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize}>{item.kind}</Text>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon as={IconChevronRight} size="sm" tone="subtle" stroke={2.4} /></View>
      </Pressable>
      {open ? (item.fields ?? []).map((field) => <FieldRow key={field} path={item.path} field={field} canReveal={canReveal} />) : null}
    </View>
  );
}

export default function VaultScreen() {
  const vault = useHostVault(true, true);
  const view = vault.data;
  const phase = view ? vaultPhase(view) : undefined;
  const items = useVaultItems(phase === 'ready');
  const answer = useVaultAnswer();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reply = (id: number, allow: boolean) => {
    setNote(null);
    answer.mutate({ id, allow }, { onError: (error) => setNote(vaultFailureMessage(error)) });
  };
  const refresh = () => {
    void vault.refetch();
    if (phase === 'ready') void items.refetch();
  };

  let body: React.ReactNode;
  if (vault.isLoading) {
    body = <YStack paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>;
  } else if (!view) {
    body = <EmptyState top icon={IconLock} title="Can’t read the vault" text={vaultFailureMessage(vault.error)} action="Try again" onAction={refresh} />;
  } else if (phase === 'offline') {
    body = <EmptyState top icon={IconLock} title="Solco Vault isn’t running" text="Open Solco Vault on your computer, then pull to refresh." />;
  } else if (phase === 'off') {
    body = <EmptyState top icon={IconLock} title="Phone access is off" text="In Solco Vault on your computer, open Settings and turn on “Answer approvals and browse from your phone”." />;
  } else if (phase === 'locked') {
    body = <EmptyState top icon={IconLock} title="The vault is locked" text="Unlock Solco Vault on your computer; this page follows." />;
  } else {
    const canReveal = view.canReveal === true;
    body = (
      <>
        {note ? <Text color={colors.danger} fontSize={13} paddingHorizontal={spacing.screen} paddingTop={12}>{note}</Text> : null}
        <Section first title={view.approvals.length > 0 ? 'Waiting for you' : undefined} footer={view.approvals.length === 0 ? 'Nothing is waiting. A request from an Agent shows up here and as a notification.' : undefined}>
          {view.approvals.length === 0 ? null : (
            <YStack gap={8} padding={8}>
              {view.approvals.map((a) => (
                <ApprovalCard key={a.id} approval={a} busy={answer.isPending} onAnswer={(allow) => reply(a.id, allow)} />
              ))}
            </YStack>
          )}
        </Section>
        <Section title="Items" footer={canReveal ? 'Show reads one value from your computer and hides it again after 30 seconds. Each read is written to Activity in Solco Vault.' : 'Names only. Values stay on your computer unless you allow showing them in Solco Vault’s Settings.'}>
          {items.isLoading ? (
            <View style={{ padding: 14 }}><ListSkeleton rows={3} /></View>
          ) : items.data && items.data.length > 0 ? (
            items.data.map((item) => <ItemRow key={item.path} item={item} open={open === item.path} onToggle={() => setOpen(open === item.path ? null : item.path)} canReveal={canReveal} />)
          ) : (
            <Text color={colors.textMuted} fontSize={13} padding={14}>{items.error ? vaultFailureMessage(items.error) : 'No items.'}</Text>
          )}
        </Section>
      </>
    );
  }

  return (
    <Screen back title="Vault">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView flex={1} contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }} refreshControl={pullRefresh(vault.isRefetching, refresh)}>
          {body}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
