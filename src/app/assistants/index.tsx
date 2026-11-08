// [INPUT]: the paired Host's Assistants overview (GET /api/v3/personal-agent/overview, needs `capabilities.personalAgent`; creating
//          one needs `capabilities.personalAgentManage`), the archived Groups count, and the events frame `personal-agent.changed`
//          that re-reads the overview.
// [OUTPUT]: AssistantsScreen — Settings → Assistants (designs/mobile-t3-redesign `assistants`): the Primary Assistant row (its Chat),
//           the Groups group (Groups, Archived groups), and the Primary's own pages (Memory, Behavior, Settings). Other Assistants,
//           Needs you and New Assistant join the first group only when the Mac has them / allows them.
// [POS]: Second client of the desktop Assistants page. The Go core on the Mac owns Assistants, Goals, Tasks, Memory and
//        Approvals; the phone only reads them and sends the few exact writes its Host route offers. Selection is client-local —
//        opening an Assistant here never moves the Mac user's navigation. Nothing here schedules or runs work. Groups are not
//        drawn in the Chats list (2026-11-07): they are reached from here.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { KeyboardInset } from '@/components/keyboard-inset';
import { ListRow, Section } from '@/components/list-group';
import { OptionSheet } from '@/components/option-sheet';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import { assistantLine, personalAgentMessage, receiptId, sortAssistants } from '@/features/host/personal-agent-model';
import { useArchivedGroups, useBootstrapV3, usePersonalAgentOverview, usePersonalAgentWrite } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconAlertTriangle, IconInbox, IconPlus, IconSettings, IconSparkles, IconStack2, IconTool, IconVersions } from '@/theme/glyphs';
import { colors, spacing } from '@/theme/tokens';

export default function AssistantsScreen() {
  const router = useRouter();
  const { connection } = useHostV3();
  const bootstrap = useBootstrapV3();
  const caps = bootstrap.data?.capabilities;
  const served = caps?.personalAgent === true;
  const manage = caps?.personalAgentManage === true;
  const groupsServed = caps?.personalAgentGroups === true;
  const archiveServed = caps?.personalAgentGroupArchive === true;
  const overview = usePersonalAgentOverview(served);
  const archived = useArchivedGroups(served && archiveServed);
  const write = usePersonalAgentWrite();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const hostName = connection?.name || bootstrap.data?.hostName || undefined;

  const rows = overview.data ? sortAssistants(overview.data.assistants) : [];
  const primary = rows.find((row) => row.primary === true);
  const others = rows.filter((row) => row !== primary);
  const approvals = rows.reduce((sum, row) => sum + row.approvals, 0);
  const asking = primary ? primary.needsYou + primary.approvals : 0;
  const groups = overview.data?.groups ?? [];
  const settingsServed = caps?.personalAgentPersona === true || caps?.personalAgentMemory === true || caps?.personalAgentProactivity === true;
  const open = (id: string) => router.push({ pathname: '/assistants/[id]', params: { id } });
  const page = (pathname: '/assistants/memory/[id]' | '/assistants/behavior/[id]' | '/assistants/settings/[id]') => () => {
    if (primary) router.push({ pathname, params: { id: primary.id } });
  };

  const create = () =>
    write.mutate(
      { kind: 'create', name: name.trim(), description: description.trim() },
      {
        onSuccess: (receipt) => {
          const id = receiptId(receipt);
          setCreating(false);
          setName('');
          setDescription('');
          if (id) open(id);
        },
      },
    );

  let body: React.ReactNode;
  if (bootstrap.isLoading || (served && overview.isLoading)) {
    body = (
      <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}>
        <ListSkeleton rows={3} />
      </YStack>
    );
  } else if (!served) {
    body = <EmptyState icon={IconSparkles} title="Assistants aren’t available" text="Turn on Automations in Solco on your computer and update it, then pull to refresh." />;
  } else if (!overview.data) {
    body = <EmptyState icon={IconAlertTriangle} title="Can’t read Assistants" text={personalAgentMessage(overview.error)} action="Retry" onAction={() => void overview.refetch()} />;
  } else {
    body = (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        refreshControl={pullRefresh(overview.isRefetching, () => void overview.refetch())}>
        {rows.length === 0 && !manage ? (
          <EmptyState icon={IconSparkles} title="No Assistants yet" text="Create one on your computer." />
        ) : (
          <>
            <Section first>
              {primary ? (
                <ListRow
                  leading={<Icon as={IconSparkles} size="sm" tone="text" />}
                  label="Primary Assistant"
                  detail={asking > 0 ? `${asking} need${asking === 1 ? 's' : ''} you` : undefined}
                  onPress={() => open(primary.id)}
                />
              ) : null}
              {others.map((row) => (
                <ListRow key={row.id} leading={<Avatar id={row.id} name={row.name} size={24} />} label={row.name} description={assistantLine(row)} onPress={() => open(row.id)} />
              ))}
              {approvals > 0 ? <ListRow icon={IconInbox} label="Needs you" detail={String(approvals)} onPress={() => router.push('/assistants/approvals')} /> : null}
              {manage ? <ListRow icon={IconPlus} label="New Assistant" onPress={() => setCreating(true)} /> : null}
            </Section>
            {groupsServed || archiveServed ? (
              <Section title="Groups">
                {groupsServed ? <ListRow icon={IconStack2} label="Groups" detail={String(groups.length)} onPress={() => router.push('/assistants/groups')} /> : null}
                {archiveServed ? <ListRow icon={IconInbox} label="Archived groups" detail={archived.data ? String(archived.data.length) : undefined} onPress={() => router.push('/assistants/archived-groups')} /> : null}
              </Section>
            ) : null}
            {primary && (caps?.personalAgentMemory === true || caps?.personalAgentProactivity === true || settingsServed) ? (
              <Section title="Primary Assistant">
                {caps?.personalAgentMemory === true ? <ListRow icon={IconVersions} label="Memory" onPress={page('/assistants/memory/[id]')} /> : null}
                {caps?.personalAgentProactivity === true ? <ListRow icon={IconTool} label="Behavior" onPress={page('/assistants/behavior/[id]')} /> : null}
                {settingsServed ? <ListRow icon={IconSettings} label="Settings" onPress={page('/assistants/settings/[id]')} /> : null}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <Screen back title="Assistants" subtitle={hostName}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <KeyboardInset>{body}</KeyboardInset>
      </SafeAreaView>
      <OptionSheet visible={creating} title="New Assistant" onClose={() => setCreating(false)}>
        <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 12 }}>
          <Field value={name} onChange={setName} placeholder="Name (e.g. PR reviewer)" />
          <Field value={description} onChange={setDescription} placeholder="What it is for (optional)" multiline />
          {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}
          <XStack gap={8}>
            <PillButton label="Create" disabled={write.isPending || name.trim() === ''} onPress={create} />
            <PillButton label="Cancel" tone="soft" onPress={() => setCreating(false)} />
          </XStack>
        </View>
      </OptionSheet>
    </Screen>
  );
}
