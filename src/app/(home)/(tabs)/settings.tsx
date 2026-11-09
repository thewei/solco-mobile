// [INPUT]: the phone's paired Macs, the Host's capabilities, the Assistants overview, the Automations list and the tree (only for counts).
// [OUTPUT]: Settings — the fourth tab: Connections (Hosts, Remote Desktop, Notifications), Agents (Assistants, Feedback, Automations) and Code
//           (Workspaces) as grouped rows with their counts on the right, then App → Appearance (a row that opens the choice page). A row whose capability the Host does not advertise is not drawn.
// [POS]: Where the old Home ⋯ menu's four items and Connection settings moved (designs/mobile-t3-redesign `settings`). No Appearance
//        row until 2026-11-08; now an App group with one Appearance row (the current choice on the right) closes the page; the choice itself is the second-level `/appearance` page, like every other setting. The counts are read-only hints from queries the destination pages already run.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useRouter } from 'expo-router';
import { Platform, ScrollView } from 'react-native';

import { ListRow, Section, SwitchRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { useHostAutomations, useHostFeedback, useHostInstance, usePersonalAgentOverview, useTreeV3 } from '@/features/host/queries-v3';
import { APPEARANCE_LABEL } from '@/lib/appearance';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useAppearanceStore } from '@/state/appearance-store';
import { useChatPrefsStore } from '@/state/chat-prefs-store';
import { IconBell, IconBookmark, IconClock, IconDeviceDesktop, IconDeviceLaptop, IconFolders, IconInbox, IconPalette, IconSparkles } from '@/theme/glyphs';


const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export default function SettingsScreen() {
  const router = useRouter();
  const appearance = useAppearanceStore((state) => state.appearance);
  const { chatOutline, setChatOutline } = useChatPrefsStore();
  const { hosts } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const caps = bootstrap.data?.capabilities;
  const overview = usePersonalAgentOverview(caps?.personalAgent === true);
  const automations = useHostAutomations(caps?.automations === true);
  const feedback = useHostFeedback(caps?.feedback === true);
  const tree = useTreeV3(instance);
  const assistants = overview.data?.assistants.length;
  const groups = overview.data?.groups.length ?? 0;
  const workspaces = tree.data?.workspaces.length;
  // Workspaces open Files, Changes and Terminal even with no chat running: any of the three reads makes the page useful.
  const workspacesServed = caps?.chat === true || caps?.files === true || caps?.git === true;

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Section first title="Connections">
          <ListRow icon={IconDeviceDesktop} label="Hosts" detail={String(hosts.length)} onPress={() => router.push('/connect')} />
          {caps?.remoteDesktop ? <ListRow icon={IconDeviceLaptop} label="Remote Desktop" onPress={() => router.push('/desktop')} /> : null}
          {Platform.OS === 'android' ? <ListRow icon={IconBell} label="Notifications" onPress={() => router.push('/notifications')} /> : null}
        </Section>
        {caps?.personalAgent || caps?.automations || caps?.feedback ? (
          <Section title="Agents">
            {caps.personalAgent ? (
              <ListRow
                icon={IconSparkles}
                label="Assistants"
                detail={assistants === undefined ? undefined : groups > 0 ? `${assistants} + ${plural(groups, 'group')}` : String(assistants)}
                onPress={() => router.push('/assistants')}
              />
            ) : null}
            {caps.feedback ? <ListRow icon={IconInbox} label="Feedback" detail={feedback.data && feedback.data.waiting > 0 ? `${feedback.data.waiting} waiting` : undefined} onPress={() => router.push('/feedback')} /> : null}
            {caps.automations ? <ListRow icon={IconClock} label="Automations" detail={automations.data ? String(automations.data.automations.length) : undefined} onPress={() => router.push('/automations')} /> : null}
          </Section>
        ) : null}
        {workspacesServed ? (
          <Section title="Code">
            <ListRow icon={IconFolders} label="Workspaces" detail={workspaces === undefined ? undefined : String(workspaces)} onPress={() => router.push('/workspaces')} />
          </Section>
        ) : null}
        <Section title="App">
          <ListRow icon={IconPalette} label="Appearance" detail={APPEARANCE_LABEL[appearance]} onPress={() => router.push('/appearance')} />
          <SwitchRow
            icon={IconBookmark}
            label="Conversation outline (TOC)"
            description="TOC tick rail beside messages"
            value={chatOutline}
            onValueChange={setChatOutline}
          />
        </Section>
      </ScrollView>
    </Screen>
  );
}
