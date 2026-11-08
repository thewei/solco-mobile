// [INPUT]: a route param `id` (the Assistant) and its two memory notes from the Mac (the person's USER.md and the Assistant's ASSISTANT.md, each with a rev).
// [OUTPUT]: MemoryScreen — read and edit both notes; a save replaces one note whole and names the rev it was made from.
// [POS]: Needs `capabilities.personalAgentMemory`; writes need `personalAgentManage`. Mirrors the desktop's Memory tab: memory is two plain Markdown
//        notes the Assistant reads together, with no approval step (the Assistant writes down what it learns on its own). The Mac's core owns the
//        files (the same two files sit in a folder a person can open on the Mac — there is no file tree here). A note that moved on while you
//        were typing is never merged: saving it is refused (`stale_revision`) and the screen offers to reload.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import type { NoteFile } from '@/contracts/host-v3';
import { noteSync } from '@/features/host/memory-model';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useAssistantDetail, useAssistantNotes, useBootstrapV3, useNotesWrite, type NotesJob } from '@/features/host/queries-v3';
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
  const memory = useAssistantNotes(id ?? '', served);
  const detail = useAssistantDetail(id ?? '', served);
  const write = useNotesWrite(id ?? '');
  const notes = memory.data;
  // A job's own `done` runs only once the Mac confirmed it: a failed write leaves the text where the person typed it.
  const save: Save = (job, done) => write.mutate(job, { onSuccess: done });
  return (
    <Screen back title="Memory" subtitle={detail.data?.assistant.name}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <KeyboardInset>
          {!served && !bootstrap.isLoading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Memory is not available</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
            </YStack>
          ) : !notes ? (
            memory.isError ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this memory</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(memory.error)}</Text>
              </YStack>
            ) : (
              <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={2} /></YStack>
            )
          ) : (
            <ScrollView
              flex={1}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32, gap: 10 }}
              refreshControl={pullRefresh(memory.isRefetching, () => void memory.refetch())}>
              <Note>Keep passwords out.</Note>
              {write.error ? <Note tone="bad">{personalAgentMessage(write.error)}</Note> : null}
              <SectionLabel inset={false}>Your notes</SectionLabel>
              <NoteCard key={`${id}:user`} file="user" note={notes.user} editable={manage} busy={write.isPending} save={save} />
              <SectionLabel inset={false}>Assistant’s notes</SectionLabel>
              <NoteCard key={`${id}:assistant`} file="assistant" note={notes.assistant} editable={manage} busy={write.isPending} save={save} />
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </Screen>
  );
}

type Save = (job: NotesJob, done?: () => void) => void;

function NoteCard({ file, note, editable, busy, save }: { file: NotesJob['file']; note: NoteFile; editable: boolean; busy: boolean; save: Save }) {
  // base is the version the draft started from; a save is made against its rev.
  const [base, setBase] = useState(note);
  const [text, setText] = useState(note.text);
  const sync = noteSync({ base, text }, note);
  useEffect(() => {
    if (sync.adopt) {
      setBase(note);
      setText(note.text);
    }
  }, [note]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card padded gap={10}>
      {editable ? (
        <Field value={text} onChange={setText} multiline placeholder="Nothing written yet." />
      ) : (
        <Text color={note.text === '' ? colors.textMuted : colors.text} fontSize={14} lineHeight={20}>{note.text === '' ? 'Nothing written yet.' : note.text}</Text>
      )}
      {sync.conflict ? <Note tone="warn">This note changed while you were editing, so saving would be refused. Reload to see the new text (your edit is dropped).</Note> : null}
      {editable && sync.dirty ? (
        <XStack gap={8}>
          <PillButton label="Save" compact disabled={busy || sync.conflict} onPress={() => save({ file, text, rev: base.rev })} />
          <PillButton label={sync.conflict ? 'Reload' : 'Discard'} tone="soft" compact onPress={() => { setBase(note); setText(note.text); }} />
        </XStack>
      ) : null}
    </Card>
  );
}
