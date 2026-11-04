// [INPUT]: visibility, the commit plan (staged paths + the ones edited again after staging), a busy flag, a refusal sentence and the submit/close handlers.
// [OUTPUT]: GitCommitSheet — a dialog with a Subject line, an optional Body, what will be committed, and the one Commit button.
// [POS]: The explicit confirmation of "Commit" on the Changes screen: nothing is committed until this button is pressed
//        with a subject. Anchored near the top (not the bottom) so the soft keyboard never covers it — the keyboard
//        hooks of KeyboardInset are not reliable inside a Modal on edge-to-edge Android.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input, Text, XStack, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import type { CommitPlan } from '@/features/host/git-model';
import { colors, radii } from '@/theme/tokens';

const SUBJECT_MAX = 200;

export function GitCommitSheet({
  visible,
  plan,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  plan: CommitPlan | null;
  busy: boolean;
  error: string | null;
  onSubmit: (subject: string, body: string) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // The parent remounts the sheet (key) after a commit: a committed message is gone, a refused one stays so it is not retyped.
  const trimmed = subject.trim();
  const count = plan?.paths.length ?? 0;
  const mixed = plan?.alsoUnstaged.length ?? 0;
  const submit = () => {
    if (!trimmed || busy || !plan) return;
    onSubmit(trimmed, body.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
        <YStack
          marginHorizontal="$4"
          marginTop="$6"
          padding="$4"
          gap="$3"
          backgroundColor={colors.surface}
          borderColor={colors.border}
          borderWidth={1}
          borderRadius={radii.lg}>
          <Text color={colors.text} fontSize={17} fontWeight="700">Commit {count} {count === 1 ? 'file' : 'files'}</Text>
          <Input
            unstyled
            autoFocus
            value={subject}
            onChangeText={setSubject}
            maxLength={SUBJECT_MAX}
            returnKeyType="next"
            placeholder="Subject (required)"
            placeholderTextColor="$placeholderColor"
            disabled={busy}
            color={colors.text}
            fontSize={15}
            fontWeight="600"
            paddingHorizontal="$3"
            paddingVertical="$2.5"
            backgroundColor={colors.surfaceRaised}
            borderRadius={radii.sm}
          />
          <Input
            unstyled
            multiline
            value={body}
            onChangeText={setBody}
            placeholder="Body (optional)"
            placeholderTextColor="$placeholderColor"
            disabled={busy}
            color={colors.text}
            fontSize={14}
            minHeight={72}
            maxHeight={160}
            textAlignVertical="top"
            paddingHorizontal="$3"
            paddingVertical="$2.5"
            backgroundColor={colors.surfaceRaised}
            borderRadius={radii.sm}
          />
          {mixed > 0 ? (
            <Text color={colors.attention} fontSize={12.5} lineHeight={18}>
              {mixed === 1 ? '1 staged file was edited again after staging' : `${mixed} staged files were edited again after staging`} — those edits are committed too.
            </Text>
          ) : null}
          {error ? <Text color={colors.danger} fontSize={13} lineHeight={19}>{error}</Text> : null}
          <XStack gap="$2" justifyContent="flex-end">
            <PillButton label="Cancel" tone="soft" onPress={onClose} disabled={busy} />
            <PillButton label={busy ? 'Committing…' : 'Commit'} onPress={submit} disabled={busy || !trimmed} />
          </XStack>
        </YStack>
      </SafeAreaView>
    </Modal>
  );
}
