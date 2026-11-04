// [INPUT]: a route param `id` (the Assistant) and its persona from the Mac (instructions, Agent profile + what really runs, MCP servers).
// [OUTPUT]: WorkStyleScreen — edit the Assistant's instructions (versioned, restore an older one), pick the Agent/Model/Effort new
//           starts use, allow or withdraw MCP servers and Check which of them an Agent really connects to.
// [POS]: Needs `capabilities.personalAgentPersona`. Mirrors the desktop's Work style tab; the Mac's core owns everything — a save is
//        one revision-fenced write (stale changes nothing and the page shows the Mac's truth), and it only reaches Agents started
//        afterwards (a running one keeps what it started with, which this screen says). MCP shows four facts apart; "connected"
//        appears only from a Check, which starts a headless Agent on the Mac and can take up to a minute.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import type { Instructions, McpView, Runtime } from '@/contracts/host-v3';
import { agoShort } from '@/features/host/pane-model';
import { behindSurfaces, personaMessage, serverChips, surfaceLabel, takesEffort, type Chip } from '@/features/host/persona-model';
import { useAssistantDetail, useAssistantPersona, useBootstrapV3, usePersonaWrite } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

const TONE: Record<Chip['tone'], string> = { ok: colors.success, warn: colors.attention, bad: colors.danger, muted: colors.textMuted };

function Note({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'bad' }) {
  return <Text color={tone === 'bad' ? colors.danger : colors.textMuted} fontSize={12.5} lineHeight={18}>{children}</Text>;
}

export default function WorkStyleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentPersona === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const persona = useAssistantPersona(id ?? '', served);
  const detail = useAssistantDetail(id ?? '', served);
  const write = usePersonaWrite(id ?? '');
  const data = persona.data;
  return (
    <>
      <Stack.Screen options={{ title: detail.data?.assistant.name ? `${detail.data.assistant.name} · Work style` : 'Work style' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <KeyboardInset>
          {!served && !bootstrap.isLoading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Work style is not available</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
            </YStack>
          ) : !data ? (
            persona.isError ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this Assistant</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personaMessage(persona.error)}</Text>
              </YStack>
            ) : (
              <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
            )
          ) : (
            <ScrollView
              flex={1}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32, gap: 10 }}
              refreshControl={pullRefresh(persona.isRefetching, () => void persona.refetch())}>
              {write.error ? <Note tone="bad">{personaMessage(write.error)}</Note> : null}
              <InstructionsCard key={`i:${data.instructions.revision}`} ins={data.instructions} editable={manage} busy={write.isPending} write={write.mutate} />
              <RuntimeCard key={`r:${data.runtime.profile.revision}`} runtime={data.runtime} editable={manage} busy={write.isPending} write={write.mutate} />
              <McpCard mcp={data.mcp} editable={manage} busy={write.isPending} checking={write.isPending && write.variables?.kind === 'verify'} write={write.mutate} />
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </>
  );
}

type Write = ReturnType<typeof usePersonaWrite>['mutate'];

function InstructionsCard({ ins, editable, busy, write }: { ins: Instructions; editable: boolean; busy: boolean; write: Write }) {
  const now = useNow(60_000);
  const [text, setText] = useState(ins.body);
  const [history, setHistory] = useState(false);
  const dirty = text.trim() !== ins.body.trim();
  const behind = behindSurfaces(ins);
  return (
    <>
      <SectionLabel inset={false}>{`Instructions · rev ${ins.revision}`}</SectionLabel>
      <Card padded gap={10}>
        <Note>How this Assistant works and talks. Agents started after you save use the new text; one already running keeps the version it started with.</Note>
        <Field value={text} onChange={setText} multiline placeholder="Working style" />
        {editable ? (
          <XStack gap={8}>
            <PillButton label="Save" compact disabled={busy || !dirty || text.trim() === ''} onPress={() => write({ kind: 'instructions', body: text.trim(), revision: ins.revision })} />
            {dirty ? <PillButton label="Discard" tone="soft" compact onPress={() => setText(ins.body)} /> : null}
          </XStack>
        ) : null}
        {behind.length > 0 ? <Note>{`Running an older version until restarted: ${behind.map((b) => `${surfaceLabel(b.surface)} (rev ${b.revision})`).join(', ')}.`}</Note> : null}
        {ins.history.length > 1 ? <PillButton label={history ? 'Hide history' : 'History'} tone="soft" compact onPress={() => setHistory((open) => !open)} /> : null}
        {history
          ? ins.history.map((h) => (
              <XStack key={h.revision} alignItems="center" justifyContent="space-between" gap={8}>
                <Text flex={1} color={colors.textMuted} fontSize={12.5} numberOfLines={1}>{`rev ${h.revision} · ${h.source} · ${agoShort(h.createdAt, now)}`}</Text>
                {h.revision === ins.revision ? (
                  <Text color={colors.success} fontSize={12}>current</Text>
                ) : editable ? (
                  <PillButton label="Restore" tone="soft" compact disabled={busy} onPress={() => write({ kind: 'restore', revision: h.revision, expected: ins.revision })} />
                ) : null}
              </XStack>
            ))
          : null}
      </Card>
    </>
  );
}

function RuntimeCard({ runtime, editable, busy, write }: { runtime: Runtime; editable: boolean; busy: boolean; write: Write }) {
  const p = runtime.profile;
  const { data } = useAssistantDetail(p.assistantId, true);
  const [agent, setAgent] = useState(p.agent);
  const [model, setModel] = useState(p.model);
  const [effort, setEffort] = useState(p.effort);
  const takes = takesEffort(agent);
  const dirty = agent !== p.agent || model !== p.model || effort !== p.effort;
  const agents = data?.agents ?? [];
  return (
    <>
      <SectionLabel inset={false}>Agent</SectionLabel>
      <Card padded gap={10}>
        <Note>What new conversations and tasks start on. A running Agent is never restarted by a change here.</Note>
        <XStack gap={8} flexWrap="wrap">
          <PillButton label="Default" compact tone={agent === '' ? 'primary' : 'soft'} onPress={() => setAgent('')} />
          {agents.map((kind) => (
            <PillButton key={kind.id} label={kind.label} compact tone={agent === kind.id ? 'primary' : 'soft'} onPress={() => setAgent(kind.id)} />
          ))}
        </XStack>
        <Field value={model} onChange={setModel} placeholder="Model (optional)" />
        {takes ? <Field value={effort} onChange={(v) => setEffort(v.trim())} placeholder="Thinking effort, e.g. low, medium, high (optional)" /> : <Note>This Agent takes no thinking effort.</Note>}
        {editable ? <PillButton label="Save" compact disabled={busy || !dirty} onPress={() => write({ kind: 'runtime', agent, model: model.trim(), effort: takes ? effort : '', revision: p.revision })} /> : null}
        <SectionLabel inset={false}>Running now</SectionLabel>
        {runtime.running.length === 0 ? <Note>No Agent is running for this Assistant.</Note> : null}
        {runtime.running.map((r) => (
          <XStack key={r.taskId} alignItems="center" justifyContent="space-between" gap={8}>
            <Text color={colors.text} fontSize={13.5}>{surfaceLabel(r.surface)}</Text>
            <Text flex={1} color={colors.textMuted} fontSize={12.5} numberOfLines={1}>{`${r.agent}${r.model ? ` · ${r.model}` : ''}`}</Text>
            <Text color={colors.textMuted} fontSize={12}>{r.state}</Text>
          </XStack>
        ))}
      </Card>
    </>
  );
}

function McpCard({ mcp, editable, busy, checking, write }: { mcp: McpView; editable: boolean; busy: boolean; checking: boolean; write: Write }) {
  const granted = mcp.servers.filter((s) => s.granted).length;
  return (
    <>
      <SectionLabel inset={false}>{`MCP servers · ${granted} allowed`}</SectionLabel>
      <Card padded gap={10}>
        <Note>The servers from your own Claude and Codex setup. Allowed servers are the only ones this Assistant’s Claude Code agents load. Changes apply to the next start. Access is per server: a server’s every tool is allowed or none, and this is a launch setting for Claude Code agents, not a sandbox for the other tools those agents can run on this Mac.</Note>
        {!mcp.supported && mcp.unsupported ? <Note>{mcp.unsupported}</Note> : null}
        {mcp.servers.length === 0 ? <Note>No MCP servers found in your configuration.</Note> : null}
        {mcp.servers.map((s) => (
          <YStack key={s.id} gap={4} paddingTop={8} borderTopWidth={1} borderTopColor={colors.border}>
            <XStack alignItems="center" justifyContent="space-between" gap={8}>
              <YStack flex={1}>
                <Text color={colors.text} fontSize={14} fontWeight="600" numberOfLines={1}>{s.name}</Text>
                <Text color={colors.textMuted} fontSize={12} numberOfLines={1}>{s.transport ? `${s.transport}${s.summary ? ` · ${s.summary}` : ''}` : ''}</Text>
              </YStack>
              {editable && mcp.supported && (s.granted || s.agents.includes('claude')) ? (
                <PillButton label={s.granted ? 'Allowed' : 'Allow'} compact tone={s.granted ? 'primary' : 'soft'} disabled={busy} onPress={() => write({ kind: 'grant', serverId: s.id, granted: !s.granted })} />
              ) : null}
            </XStack>
            <XStack gap={10} flexWrap="wrap">
              {serverChips(s).map((chip) => (
                <Text key={chip.text} color={TONE[chip.tone]} fontSize={12}>{chip.text}</Text>
              ))}
            </XStack>
          </YStack>
        ))}
        {editable ? <PillButton label={checking ? 'Checking…' : 'Check connections'} tone="soft" compact disabled={busy || !mcp.supported || granted === 0} onPress={() => write({ kind: 'verify' })} /> : null}
        <Note>Check starts a headless Claude Code agent on your computer and reads which servers it connects to; it sends no prompt to a model.</Note>
      </Card>
    </>
  );
}
