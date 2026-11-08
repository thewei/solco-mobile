// [INPUT]: the grouped agents (summarize), the host's name and a pick handler.
// [OUTPUT]: AgentGroups — Needs you / Working / Idle: a Shelf label over ThreadRows (two-line cards for the first two, slim
//           rows for Idle).
// [POS]: The "choose an agent" list of Share to Solco. Client-local; picking only navigates — nothing is sent for the user.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Shelf } from '@/components/list-group';
import { ThreadRow } from '@/components/thread-row';
import { agentAge, agoShort, paneTitle, reportsAges, type FlatPane } from '@/features/host/pane-model';

type Pane = FlatPane['pane'];

function Group({ label, items, kind, hostName, now, agesKnown, onOpen }: { label: string; items: FlatPane[]; kind: 'needs' | 'working' | 'idle'; hostName: string; now: number; agesKnown: boolean; onOpen: (pane: Pane) => void }) {
  if (items.length === 0) return null;
  return (
    <>
      <Shelf label={label} count={String(items.length)} />
      {items.map(({ pane, workspace }) => {
        const age = agoShort(pane.agent?.lastActiveMs, now);
        return kind === 'idle' ? (
          <ThreadRow key={pane.paneId} slim workspace={workspace.label} title={paneTitle(pane)} time={agentAge(pane, now, agesKnown)} onPress={() => onOpen(pane)} />
        ) : (
          <ThreadRow
            key={pane.paneId}
            workspace={workspace.label}
            title={paneTitle(pane)}
            status={kind}
            statusExtra={kind === 'working' ? age : undefined}
            host={hostName}
            provider={pane.agent?.provider}
            onPress={() => onOpen(pane)}
          />
        );
      })}
    </>
  );
}

export function AgentGroups({ summary, hostName, now, onOpen }: { summary: { needsYou: FlatPane[]; working: FlatPane[]; idle: FlatPane[] }; hostName: string; now: number; onOpen: (pane: Pane) => void }) {
  const agesKnown = reportsAges([...summary.needsYou, ...summary.working, ...summary.idle]);
  return (
    <>
      <Group label="Needs you" items={summary.needsYou} kind="needs" hostName={hostName} now={now} agesKnown={agesKnown} onOpen={onOpen} />
      <Group label="Working" items={summary.working} kind="working" hostName={hostName} now={now} agesKnown={agesKnown} onOpen={onOpen} />
      <Group label="Idle" items={summary.idle} kind="idle" hostName={hostName} now={now} agesKnown={agesKnown} onOpen={onOpen} />
    </>
  );
}
