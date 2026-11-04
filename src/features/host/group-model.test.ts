import { describe, expect, it } from 'vitest';

import type { GroupFeed, GroupMember, GroupMessage } from '@/contracts/host-v3';
import { agentNotes, applyMention, avatarInitial, avatarTone, chatRows, factLine, mentionChoices, mentionQuery, mentionsIn, resolveMentions, splitMentions } from '@/features/host/group-model';

const ada: GroupMember = { assistantId: 'a_1', name: 'Ada', status: 'active' };
const bo: GroupMember = { assistantId: 'a_2', name: 'Bo', status: 'active' };
const bobby: GroupMember = { assistantId: 'a_3', name: 'Bobby', status: 'active' };
const members = [ada, bo, bobby];

function msg(over: Partial<GroupMessage> & Pick<GroupMessage, 'seq' | 'id'>): GroupMessage {
  return { groupId: 'g_1', authorKind: 'user', kind: 'text', body: '', mentions: [], createdAt: 1_000, ...over };
}

describe('avatars', () => {
  it('colour follows the stable id (same as the desktop), not the name', () => {
    expect(avatarTone('a_1')).toBe(avatarTone('a_1'));
    expect(avatarTone('a_1')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('initial is the first letter/number, CJK and emoji safe', () => {
    expect(avatarInitial(' ada')).toBe('A');
    expect(avatarInitial('小明')).toBe('小');
    expect(avatarInitial('🙂')).toBe('🙂');
    expect(avatarInitial('')).toBe('?');
  });
});

describe('exact @', () => {
  it('only a member whose exact @Name is in the text is mentioned', () => {
    expect(mentionsIn('@Bo can you check', members)).toEqual(['a_2']);
    expect(mentionsIn('hello team', members)).toEqual([]);
    expect(mentionsIn('mail bo@example.com', members)).toEqual([]);
  });
  it('a longer name is never read as its prefix', () => {
    expect(mentionsIn('@Bobby ping', members)).toEqual(['a_3']);
    expect(mentionsIn('@Bobby and @Bo', members).sort()).toEqual(['a_2', 'a_3']);
  });
  it('the body splits into plain parts and chips', () => {
    expect(splitMentions('hi @Ada, ok', members)).toEqual([
      { text: 'hi ', mention: false },
      { text: '@Ada', mention: true },
      { text: ', ok', mention: false },
    ]);
  });
});

describe('equal names are told apart by the picker only (audit P0-01)', () => {
  const ada2: GroupMember = { assistantId: 'a_9', name: 'Ada', status: 'active' };
  const twins = [ada, ada2, bo];
  it('typed text never picks one of two Adas', () => {
    expect(resolveMentions('@Ada look', twins)).toEqual({ ids: [], ambiguous: ['Ada'] });
  });
  it('a pick decides which Ada, and wakes only that one', () => {
    expect(resolveMentions('@Ada look', twins, [ada2])).toEqual({ ids: ['a_9'], ambiguous: [] });
  });
  it('two tokens with two picks wake both; one token with two picks wakes one', () => {
    expect(resolveMentions('@Ada and @Ada', twins, [ada, ada2]).ids).toEqual(['a_1', 'a_9']);
    expect(resolveMentions('@Ada only', twins, [ada, ada2]).ids).toEqual(['a_1']);
  });
  it('a pick whose token was edited away wakes nobody', () => {
    expect(resolveMentions('hello', twins, [ada])).toEqual({ ids: [], ambiguous: [] });
  });
  it('a CJK name needs no space around it', () => {
    const cjk: GroupMember = { assistantId: 'a_c', name: '张三', status: 'active' };
    expect(resolveMentions('请@张三帮忙', [cjk, bo]).ids).toEqual(['a_c']);
  });
  it('an address inside a word is no mention', () => {
    expect(resolveMentions('mail ada@Ada.com', members).ids).toEqual([]);
  });
});

describe('the @ picker', () => {
  it('opens on a trailing @ token and filters by prefix first', () => {
    expect(mentionQuery('hello @b')).toBe('b');
    expect(mentionQuery('hello')).toBeNull();
    expect(mentionChoices('@b', members).map((m) => m.name)).toEqual(['Bo', 'Bobby']);
  });
  it('skips members already mentioned and paused ones', () => {
    expect(mentionChoices('@Bo and @', [ada, bo, { ...bobby, status: 'paused' }]).map((m) => m.name)).toEqual(['Ada']);
  });
  it('applying a choice replaces only the trailing token', () => {
    expect(applyMention('hi @b', bo)).toBe('hi @Bo ');
    expect(applyMention('@', ada)).toBe('@Ada ');
  });
});

describe('receipts', () => {
  const nameOf = (id: string) => members.find((m) => m.assistantId === id)?.name ?? '';
  it('words the core facts, hides the ones the delivery chip says', () => {
    expect(factLine({ event: 'agent_blocked', assistantId: 'a_2', reason: 'MCP dialog' }, nameOf)).toBe('Bo is waiting for you in its terminal: MCP dialog');
    expect(factLine({ event: 'delivered', assistantId: 'a_2' }, nameOf)).toBeNull();
    expect(factLine(undefined, nameOf)).toBeNull();
  });
  it('lists only agents that are starting or blocked', () => {
    expect(agentNotes([{ assistantId: 'a_1', state: 'none' }, { assistantId: 'a_2', state: 'blocked', paneId: 'w1:p1' }, { assistantId: 'a_3', state: 'starting' }, { assistantId: 'a_4', state: 'ready' }])).toEqual([
      { assistantId: 'a_2', kind: 'blocked', paneId: 'w1:p1' },
      { assistantId: 'a_3', kind: 'starting' },
    ]);
  });
});

describe('chatRows', () => {
  const feed: Pick<GroupFeed, 'messages' | 'deliveries' | 'tasks' | 'group'> = {
    group: { id: 'g_1', title: 'Duo', status: 'active', members, lastSeq: 5, revision: 1, createdAt: 0, updatedAt: 0 },
    messages: [
      msg({ seq: 1, id: 'm_1', body: '@Bo hi', mentions: ['a_2'] }),
      msg({ seq: 2, id: 'm_2', authorKind: 'system', kind: 'fact', fact: { event: 'delivered', assistantId: 'a_2' } }),
      msg({ seq: 3, id: 'm_3', authorKind: 'assistant', authorId: 'a_2', body: 'hello', replyTo: 'm_1', createdAt: 5_000 }),
      msg({ seq: 4, id: 'm_4', authorKind: 'assistant', authorId: 'a_2', body: 'more', createdAt: 6_000 }),
      msg({ seq: 5, id: 'm_5', authorKind: 'assistant', authorId: 'a_2', kind: 'task', taskId: 't_1', body: 'Check', createdAt: 7_000 }),
    ],
    deliveries: [{ id: 'd_1', messageId: 'm_1', assistantId: 'a_2', state: 'delivered', attempts: 1 }],
    tasks: [{ taskId: 't_1', assistantId: 'a_2', title: 'Check', state: 'running', needsYou: false, updatedAt: 7_000 }],
  };
  it('drops hidden facts, keeps quotes/deliveries/task cards and merges same-author runs', () => {
    const rows = chatRows(feed);
    expect(rows.map((r) => r.message.id)).toEqual(['m_1', 'm_3', 'm_4', 'm_5']);
    expect(rows[0]?.deliveries).toHaveLength(1);
    expect(rows[1]?.quoted?.id).toBe('m_1');
    expect(rows[1]?.continued).toBe(false);
    expect(rows[2]?.continued).toBe(true);
    expect(rows[3]?.task?.state).toBe('running');
  });
});
