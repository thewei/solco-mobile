// [INPUT]: a route param `id` (the Assistant) and its live memory from the Mac (items, tidy-up findings, versions on demand).
// [OUTPUT]: MemoryScreen — read what the Assistant remembers, add a note, edit it, approve a candidate, forget an item, read an item's versions.
// [POS]: Needs `capabilities.personalAgentMemory`; writes need `personalAgentManage`. Mirrors the desktop's Memory tab: the Mac's core
//        owns the rows (and projects them to a Markdown folder a person can edit on the Mac — there is no file tree here). Every write
//        is fenced by the item's revision, so a stale one changes nothing and the screen re-reads the Mac's truth. Notes about
//        duplicates, stale candidates and edit conflicts are the core's findings; nothing is merged or deleted for the person.
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
import type { AssistantMemory, MemoryReview } from '@/contracts/host-v3';
import { memoryAuthor, memoryNote, splitMemory } from '@/features/host/memory-model';
import { agoShort } from '@/features/host/pane-model';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useAssistantDetail, useAssistantMemory, useBootstrapV3, useMemoryHistory, useMemoryWrite, type MemoryJob } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

function Note({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'bad' | 'warn' }) {
  const color = tone === 'bad' ? colors.danger : tone === 'warn' ? colors.attention : colors.textMuted;
  return <Text color={color} fontSize={12.5} lineHeight={18}>{children}</Text>;
}

export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentMemory === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const memory = useAssistantMemory(id ?? '', served);
  const detail = useAssistantDetail(id ?? '', served);
  const write = useMemoryWrite(id ?? '');
  const review = memory.data;
  // A job's own `done` runs only once the Mac confirmed it: a failed write leaves the text where the person typed it.
  const send: Write = (job, done) => write.mutate(job, { onSuccess: done });
  return (
    <>
      <Stack.Screen options={{ title: detail.data?.assistant.name ? `${detail.data.assistant.name} · Memory` : 'Memory' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <KeyboardInset>
          {!served && !bootstrap.isLoading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Memory is not available</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
            </YStack>
          ) : !review ? (
            memory.isError ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this memory</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(memory.error)}</Text>
              </YStack>
            ) : (
              <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
            )
          ) : (
            <ScrollView
              flex={1}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32, gap: 10 }}
              refreshControl={pullRefresh(memory.isRefetching, () => void memory.refetch())}>
              {write.error ? <Note tone="bad">{personalAgentMessage(write.error)}</Note> : null}
              {manage ? <AddCard busy={write.isPending} write={send} /> : null}
              <Body review={review} editable={manage} busy={write.isPending} write={send} />
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </>
  );
}

type Write = (job: MemoryJob, done?: () => void) => void;

function AddCard({ busy, write }: { busy: boolean; write: Write }) {
  const [text, setText] = useState('');
  return (
    <>
      <SectionLabel inset={false}>Add a note</SectionLabel>
      <Card padded gap={10}>
        <Note>Something this Assistant should always know. It is used from its next turn.</Note>
        <Field value={text} onChange={setText} multiline placeholder="e.g. Release notes go in English" />
        <XStack>
          <PillButton
            label="Remember"
            compact
            disabled={busy || text.trim() === ''}
            onPress={() => write({ kind: 'add', content: text.trim() }, () => setText(''))}
          />
        </XStack>
      </Card>
    </>
  );
}

function Body({ review, editable, busy, write }: { review: MemoryReview; editable: boolean; busy: boolean; write: Write }) {
  const { candidates, approved } = splitMemory(review);
  return (
    <>
      {candidates.length > 0 ? (
        <>
          <SectionLabel inset={false}>{`To review · ${candidates.length}`}</SectionLabel>
          <Note>The Assistant proposed these (or an edit collided). Nothing here is used until you approve it.</Note>
          {candidates.map((m) => (
            <Item key={`${m.id}:${m.revision}`} item={m} review={review} editable={editable} busy={busy} write={write} />
          ))}
        </>
      ) : null}
      <SectionLabel inset={false}>{`Remembered · ${approved.length}/${review.max}`}</SectionLabel>
      {approved.length === 0 ? <Note>Nothing remembered yet.</Note> : null}
      {approved.map((m) => (
        <Item key={`${m.id}:${m.revision}`} item={m} review={review} editable={editable} busy={busy} write={write} />
      ))}
    </>
  );
}

function Item({ item, review, editable, busy, write }: { item: AssistantMemory; review: MemoryReview; editable: boolean; busy: boolean; write: Write }) {
  const now = useNow(60_000);
  const [text, setText] = useState(item.content);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const note = memoryNote(review, item);
  return (
    <Card padded gap={8}>
      {editing ? (
        <>
          <Field value={text} onChange={setText} multiline />
          <XStack gap={8}>
            <PillButton
              label="Save"
              compact
              disabled={busy || text.trim() === '' || text.trim() === item.content.trim()}
              onPress={() => write({ kind: 'edit', id: item.id, revision: item.revision, content: text.trim() }, () => setEditing(false))}
            />
            <PillButton label="Cancel" tone="soft" compact onPress={() => { setText(item.content); setEditing(false); }} />
          </XStack>
        </>
      ) : (
        <Text color={colors.text} fontSize={14} lineHeight={20}>{item.content}</Text>
      )}
      {note ? <Note tone="warn">{note}</Note> : null}
      <Text color={colors.textMuted} fontSize={11.5}>{`${item.kind === 'conflict' ? 'conflict' : item.sourceRef === 'user' ? 'you' : item.sourceRef.startsWith('file:') ? 'folder' : 'assistant'} · rev ${item.revision} · ${agoShort(item.updatedAt, now)}`}</Text>
      {editable && !editing ? (
        <XStack gap={8} flexWrap="wrap">
          {item.state === 'candidate' ? <PillButton label="Approve" compact disabled={busy} onPress={() => write({ kind: 'approve', id: item.id, revision: item.revision })} /> : null}
          <PillButton label="Edit" tone="soft" compact onPress={() => setEditing(true)} />
          <PillButton label={history ? 'Hide history' : 'History'} tone="soft" compact onPress={() => setHistory((open) => !open)} />
          {confirm ? (
            <PillButton label="Forget for good" tone="danger" compact disabled={busy} onPress={() => write({ kind: 'forget', id: item.id, revision: item.revision })} />
          ) : (
            <PillButton label="Forget" tone="danger" compact onPress={() => setConfirm(true)} />
          )}
        </XStack>
      ) : null}
      {!editable && !editing ? <PillButton label={history ? 'Hide history' : 'History'} tone="soft" compact onPress={() => setHistory((open) => !open)} /> : null}
      {history ? <History id={item.id} revision={item.revision} /> : null}
    </Card>
  );
}

function History({ id, revision }: { id: string; revision: number }) {
  const now = useNow(60_000);
  const { data, isError, error } = useMemoryHistory(id, true, revision);
  if (isError) return <Note tone="bad">{personalAgentMessage(error)}</Note>;
  if (!data) return <Note>Loading…</Note>;
  return (
    <YStack gap={6}>
      {data.map((v) => (
        <YStack key={v.revision} gap={2}>
          <Text color={colors.textMuted} fontSize={11.5}>{`rev ${v.revision} · ${memoryAuthor(v.author)} · ${v.state} · ${agoShort(v.at, now)}`}</Text>
          <Text color={colors.text} fontSize={13} lineHeight={18}>{v.content === '' ? '(forgotten)' : v.content}</Text>
        </YStack>
      ))}
    </YStack>
  );
}
