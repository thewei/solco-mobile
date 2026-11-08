import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatFrame } from '@/contracts/host-v3';

import { createChatController, ECHO_TTL_MS, type ChatOps } from './controller';
import { dispositionOf, toPageState } from './page-state';

function frame(over: Partial<ChatFrame> = {}, turns: ChatFrame['state']['turns'] = []): ChatFrame {
  return { t: 'chat', paneId: 'w1:p1', agentStatus: 'idle', state: { provider: 'claude-code', turns }, ...over };
}

function setup(over: Partial<ChatOps> = {}) {
  const ops: ChatOps = {
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    answer: vi.fn().mockResolvedValue(undefined),
    catalog: vi.fn().mockResolvedValue({ commands: [], skills: [], models: [] }),
    openTerminal: vi.fn(),
    older: vi.fn(),
    files: vi.fn().mockResolvedValue([]),
    canReview: vi.fn().mockReturnValue(false),
    review: vi.fn(),
    canQueue: vi.fn().mockReturnValue(false),
    queue: vi.fn().mockResolvedValue(undefined),
    cancelQueued: vi.fn().mockResolvedValue(undefined),
    cancelQueuedItem: vi.fn().mockResolvedValue(undefined),
    canEdit: vi.fn().mockReturnValue(false),
    editQueuedItem: vi.fn().mockResolvedValue(undefined),
    moveQueuedItem: vi.fn().mockResolvedValue(undefined),
    subagent: vi.fn().mockResolvedValue({ subagent: { id: 'abc123', provider: 'claude-code', status: 'done', toolCalls: 0 }, turns: [] }),
    canAttach: vi.fn().mockReturnValue(false),
    pickFile: vi.fn().mockResolvedValue(null),
    uploadFile: vi.fn().mockResolvedValue('/cache/ChatAttachments/x.png'),
    canVoice: vi.fn().mockReturnValue(false),
    transcribe: vi.fn().mockResolvedValue('fix the failing test'),
    openMicrophoneSettings: vi.fn(),
    ...over,
  };
  const seen: number[] = [];
  const c = createChatController('w1:p1', ops, (s) => seen.push(s.seq));
  return { c, ops, seen };
}

describe('dispositionOf', () => {
  it.each([
    ['idle', 'ready'],
    ['done', 'ready'],
    ['working', 'queue'],
    ['blocked', 'terminal'],
    ['failed', 'terminal'],
    [undefined, 'unknown'],
    ['whatever', 'unknown'],
  ])('%s → %s', (status, want) => expect(dispositionOf(status)).toBe(want));
});

describe('toPageState', () => {
  it('has no conversation yet: waiting, status from the tree, no turns', () => {
    const s = toPageState({ paneId: 'p', seq: 1, frame: null, fallbackStatus: 'idle' });
    expect(s).toMatchObject({ waiting: true, loading: false, disposition: 'ready', turns: [] });
  });

  it('names the agent of a new-session draft (no frame states one)', () => {
    expect(toPageState({ paneId: 'p', seq: 1, frame: null, fallbackStatus: 'idle', provider: 'Codex' })).toMatchObject({ provider: 'Codex', disposition: 'ready' });
    expect('provider' in toPageState({ paneId: 'p', seq: 1, frame: null, fallbackStatus: 'idle' })).toBe(false);
  });

  it('marks a pane-less state as a draft, so the invite offers no Open Terminal', () => {
    expect(toPageState({ paneId: 'p', seq: 1, frame: null, fallbackStatus: 'idle', draft: true })).toMatchObject({ draft: true, waiting: true });
    expect('draft' in toPageState({ paneId: 'p', seq: 1, frame: null, fallbackStatus: 'idle' })).toBe(false);
  });

  it('is loading, not waiting, before the first answer', () => {
    expect(toPageState({ paneId: 'p', seq: 1, frame: null, loading: true })).toMatchObject({ loading: true, waiting: false });
  });

  it('a pending launch overrides the no-conversation surface in both directions', () => {
    // starting with a prompt: the transcript (the echo row) shows instead of the invite
    expect(toPageState({ paneId: 'p', seq: 1, frame: null, echo: 'hi', waiting: false })).toMatchObject({ waiting: false, echoPending: true });
    // starting without one: the invite stays up even while the stream is still connecting
    expect(toPageState({ paneId: 'p', seq: 2, frame: null, loading: true, waiting: true })).toMatchObject({ waiting: true });
  });

  it('a settled echo keeps the row but drops the working shimmer', () => {
    const s = toPageState({ paneId: 'p', seq: 1, frame: null, echo: 'hi', echoSettled: true, waiting: false });
    expect(s.turns).toEqual([{ user: true, text: 'hi' }]);
    expect(s.echoPending).toBeUndefined();
  });

  it('maps the Host card, hides an answered one, numbers a multi-question ask', () => {
    const card = { id: 'c1', kind: 'question' as const, prompt: 'Which?', options: ['A', 'B'], step: 1, steps: 3, multi: true };
    const f = frame({ agentStatus: 'blocked', interaction: card });
    expect(toPageState({ paneId: 'p', seq: 1, frame: f }).interactions).toEqual([
      { id: 'c1', kind: 'question', prompt: 'Which?', options: ['A', 'B'], progress: '2/3', multi: true },
    ]);
    expect(toPageState({ paneId: 'p', seq: 1, frame: f, answeredId: 'c1' }).interactions).toBeUndefined();
  });

  it('adds the sent prompt as a temporary user row until the transcript has it', () => {
    const f = frame({}, [{ user: true, text: 'earlier' }]);
    const pending = toPageState({ paneId: 'p', seq: 1, frame: f, echo: 'hello' });
    expect(pending.echoPending).toBe(true);
    expect(pending.turns.at(-1)).toEqual({ user: true, text: 'hello' });
    const confirmed = toPageState({ paneId: 'p', seq: 2, frame: frame({}, [{ user: true, text: 'hello' }]), echo: 'hello' });
    expect(confirmed.echoPending).toBeUndefined();
    expect(confirmed.turns).toHaveLength(1);
  });

  it('switches off what the phone cannot do: nothing it has no data for', () => {
    const s = toPageState({ paneId: 'p', seq: 1, frame: frame() });
    expect(s.outline).toBe(true); // the tick rail is the phone's too
    expect(s.features).toEqual({ voice: false, attach: false, queue: false, edit: false, reorder: false, subagentDrawer: true });
    expect(s).not.toHaveProperty('canReview');
    expect(s).not.toHaveProperty('hasOlder');
    expect(s).not.toHaveProperty('root');
  });
});

describe('chat controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('grows seq with every state and tells the page', () => {
    const { c, seen } = setup();
    const first = c.state().seq;
    c.feed({ phase: 'live', frame: frame() });
    c.feed({ phase: 'live', frame: frame() });
    expect(seen).toEqual([first + 1, first + 2]);
  });

  it('send: delivers once, then stands the prompt in until confirmed', async () => {
    const { c, ops } = setup();
    c.feed({ phase: 'live', frame: frame() });
    const next = (await c.call('chat.Send', ['hi'])) as { echoPending?: boolean; turns: { text?: string }[] };
    expect(ops.send).toHaveBeenCalledWith('hi', false);
    expect(next.echoPending).toBe(true);
    c.feed({ phase: 'live', frame: frame({}, [{ user: true, text: 'hi' }]) });
    expect(c.state().echoPending).toBeUndefined();
  });

  it('a handed-over launch prompt stands in until the transcript confirms it', async () => {
    const { c } = setup();
    c.feed({ phase: 'live', frame: null, waiting: false });
    c.prime('build it');
    expect(c.state()).toMatchObject({ echoPending: true, turns: [{ user: true, text: 'build it' }], loading: false });
    // the real stream connecting over the standing row must not flash the loading surface
    c.feed({ phase: 'connecting', frame: null, waiting: false });
    expect(c.state().loading).toBe(false);
    // without a prompt the invite wins over the connecting spinner too
    const fresh = setup();
    fresh.c.feed({ phase: 'connecting', frame: null, waiting: true });
    expect(fresh.c.state()).toMatchObject({ loading: false, waiting: true });
    c.feed({ phase: 'live', frame: frame({}, [{ user: true, text: 'build it' }]) });
    expect(c.state().echoPending).toBeUndefined();
  });

  it('a failed start settles the echo: the row stays, the shimmer goes', async () => {
    const { c } = setup();
    c.feed({ phase: 'live', frame: null, waiting: false });
    c.prime('build it');
    c.feed({ phase: 'live', frame: null, waiting: false, fallbackStatus: 'idle', echoSettled: true });
    expect(c.state()).toMatchObject({ turns: [{ user: true, text: 'build it' }], disposition: 'ready' });
    expect(c.state().echoPending).toBeUndefined();
  });

  it('the echo expires on its own if the transcript never shows it', async () => {
    const { c } = setup();
    c.feed({ phase: 'live', frame: frame() });
    await c.call('chat.Send', ['/clear']);
    expect(c.state().echoPending).toBe(true);
    vi.advanceTimersByTime(ECHO_TTL_MS + 1);
    expect(c.state().echoPending).toBeUndefined();
  });

  it('a refused send rejects with the sentence and leaves no echo', async () => {
    const { c } = setup({ send: vi.fn().mockRejectedValue(new Error('The agent is working.')) });
    c.feed({ phase: 'live', frame: frame({ agentStatus: 'working' }) });
    await expect(c.call('chat.Send', ['hi'])).rejects.toThrow('The agent is working.');
    expect(c.state().echoPending).toBeUndefined();
  });

  it('interrupt-and-send asks the Host to cut in', async () => {
    const { c, ops } = setup();
    await c.call('chat.InterruptAndSend', ['now']);
    expect(ops.send).toHaveBeenCalledWith('now', true);
  });

  it('answers: single, typed and multi build the Host request; the card hides until the Host retires it', async () => {
    const { c, ops } = setup();
    const card = { id: 'c1', kind: 'question' as const, prompt: 'Q', options: ['A', 'Other'] };
    c.feed({ phase: 'live', frame: frame({ agentStatus: 'blocked', interaction: card }) });
    await c.call('chat.AnswerInteraction', ['c1', 'A']);
    await c.call('chat.AnswerInteractionText', ['c1', 'Other', 'mine']);
    await c.call('chat.AnswerInteractionMulti', ['c1', ['A']]);
    expect(vi.mocked(ops.answer).mock.calls.map((x) => x[0])).toEqual([
      { interactionId: 'c1', option: 'A' },
      { interactionId: 'c1', option: 'Other', text: 'mine' },
      { interactionId: 'c1', options: ['A'] },
    ]);
    expect(c.state().interactions).toBeUndefined();
    c.feed({ phase: 'live', frame: frame() }); // retired
    c.feed({ phase: 'live', frame: frame({ agentStatus: 'blocked', interaction: card }) }); // asked again
    expect(c.state().interactions).toHaveLength(1);
  });

  it('a failed answer keeps the card', async () => {
    const { c } = setup({ answer: vi.fn().mockRejectedValue(new Error('gone')) });
    const card = { id: 'c1', kind: 'question' as const, prompt: 'Q', options: ['A'] };
    c.feed({ phase: 'live', frame: frame({ agentStatus: 'blocked', interaction: card }) });
    await expect(c.call('chat.AnswerInteraction', ['c1', 'A'])).rejects.toThrow('gone');
    expect(c.state().interactions).toHaveLength(1);
  });

  it('stop and open-terminal go to their operations', async () => {
    const { c, ops } = setup();
    await c.call('chat.Stop', []);
    await c.call('chat.OpenTerminal', []);
    expect(ops.stop).toHaveBeenCalledTimes(1);
    expect(ops.openTerminal).toHaveBeenCalledTimes(1);
  });

  it('empty answers for what the phone has none of, refusals for what it cannot do', async () => {
    const { c } = setup();
    expect(await c.call('chat.Catalog', [])).toMatchObject({ commands: [], skills: [], models: [], canSwitchModel: false });
    expect(await c.call('chat.ListFiles', ['@s'])).toEqual([]);
    await expect(c.call('chat.Transcribe', ['', ''])).rejects.toThrow(/Not available/);
    await expect(c.call('chat.Nope', [])).rejects.toThrow(/Unknown call/);
  });
});

describe('dictation', () => {
  it('is on only when the Host serves it and sends the clip to the Mac untouched', async () => {
    expect(setup().c.state().features.voice).toBe(false);
    const on = setup({ canVoice: vi.fn().mockReturnValue(true) });
    expect(on.c.state().features.voice).toBe(true);
    expect(await on.c.call('chat.Transcribe', ['QUJD', 'audio/webm;codecs=opus'])).toBe('fix the failing test');
    expect(on.ops.transcribe).toHaveBeenCalledWith('QUJD', 'audio/webm;codecs=opus');
  });

  it('passes the Mac\'s refusal sentence to the page and opens system settings for a denied mic', async () => {
    const on = setup({ canVoice: vi.fn().mockReturnValue(true), transcribe: vi.fn().mockRejectedValue(new Error('This Mac has no voice source set up.')) });
    await expect(on.c.call('chat.Transcribe', ['QUJD', 'audio/webm'])).rejects.toThrow(/voice source/);
    await on.c.call('chat.OpenMicrophoneSettings', []);
    expect(on.ops.openMicrophoneSettings).toHaveBeenCalledTimes(1);
  });
});

describe('sub-agent drawer', () => {
  it('opens a sub-agent through the Host and hands the page its view', async () => {
    const { c, ops } = setup();
    expect(await c.call('chat.OpenSubagent', ['abc123'])).toMatchObject({ subagent: { id: 'abc123' }, turns: [] });
    expect(ops.subagent).toHaveBeenCalledWith('abc123');
  });

  it('a Host refusal reaches the page as its sentence', async () => {
    const { c } = setup({ subagent: vi.fn().mockRejectedValue(new Error('That sub-agent is no longer part of this conversation.')) });
    await expect(c.call('chat.OpenSubagent', ['zzz'])).rejects.toThrow('no longer part');
  });
});

describe('attachments', () => {
  const file = { dataBase64: 'cG5n', mime: 'image/png', name: 'shot.png' };

  it('are off until the Host serves them, and then the page may offer them', () => {
    const off = setup();
    off.c.feed({ phase: 'live', frame: frame() });
    expect(off.c.state().features.attach).toBe(false);
    const on = setup({ canAttach: vi.fn().mockReturnValue(true) });
    on.c.feed({ phase: 'live', frame: frame() });
    expect(on.c.state().features).toEqual({ voice: false, attach: true, queue: false, edit: false, reorder: false, subagentDrawer: true });
  });

  it('refuse a pick or an upload while the Host serves none', async () => {
    const { c, ops } = setup();
    await expect(c.call('chat.PickAttachment', [])).rejects.toThrow(/Not available/);
    await expect(c.call('chat.SaveAttachment', [file.dataBase64, file.mime, file.name])).rejects.toThrow(/Not available/);
    expect(ops.pickFile).not.toHaveBeenCalled();
    expect(ops.uploadFile).not.toHaveBeenCalled();
  });

  it('a picked file is uploaded and its path comes back; a cancelled pick is an empty answer', async () => {
    const pick = vi.fn().mockResolvedValueOnce(file).mockResolvedValueOnce(null);
    const { c, ops } = setup({ canAttach: vi.fn().mockReturnValue(true), pickFile: pick });
    expect(await c.call('chat.PickAttachment', [])).toBe('/cache/ChatAttachments/x.png');
    expect(ops.uploadFile).toHaveBeenCalledWith(file);
    expect(await c.call('chat.PickAttachment', [])).toBe('');
    expect(ops.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('a pasted or dropped file travels the same way', async () => {
    const { c, ops } = setup({ canAttach: vi.fn().mockReturnValue(true) });
    expect(await c.call('chat.SaveAttachment', [file.dataBase64, file.mime, file.name])).toBe('/cache/ChatAttachments/x.png');
    expect(ops.uploadFile).toHaveBeenCalledWith(file);
  });

  it('an upload the Host refused rejects with its sentence', async () => {
    const { c } = setup({ canAttach: vi.fn().mockReturnValue(true), uploadFile: vi.fn().mockRejectedValue(new Error('That file is too large.')) });
    await expect(c.call('chat.SaveAttachment', ['x', '', 'a.bin'])).rejects.toThrow('too large');
  });
});

describe('catalog and model switch', () => {
  const host = {
    commands: [
      { name: '/compact', insert: '/compact ', kind: 'text' },
      { name: '/model', insert: '/model ', kind: 'picker' },
    ],
    skills: [{ name: '/review', insert: '/review ', kind: 'skill' }],
    models: [{ id: 'anthropic/sonnet' }],
    modelVerb: '/model ',
    defaultModel: 'sonnet',
  };

  it('hands the page the agent\'s own rows, picker commands included (the Host answers them with a card)', async () => {
    const { c } = setup({ catalog: vi.fn().mockResolvedValue(host) });
    expect(await c.call('chat.Catalog', [])).toEqual({
      commands: host.commands,
      skills: host.skills,
      models: host.models,
      canSwitchModel: true,
      defaultModel: 'sonnet',
    });
  });

  it('carries efforts and the notes that go with them, and opens the panel for efforts alone (Claude Code)', async () => {
    const withEfforts = {
      ...host,
      models: [{ id: 'Gemini 3.8 Flash', pick: '/model Gemini 3.8 Flash (High)', efforts: [{ label: 'High', send: '/model Gemini 3.8 Flash (High)' }] }],
      modelNote: 'saved as default',
      efforts: [{ label: 'low', send: '/effort low' }],
      effortNote: 'saved per model',
    };
    const { c } = setup({ catalog: vi.fn().mockResolvedValue(withEfforts) });
    expect(await c.call('chat.Catalog', [])).toMatchObject({
      models: withEfforts.models,
      modelNote: 'saved as default',
      efforts: withEfforts.efforts,
      effortNote: 'saved per model',
    });
    const claude = setup({ catalog: vi.fn().mockResolvedValue({ ...host, models: [], modelVerb: undefined, modelPicker: '/model', efforts: withEfforts.efforts }) });
    expect(await claude.c.call('chat.Catalog', [])).toMatchObject({ canSwitchModel: true, modelPicker: '/model', efforts: withEfforts.efforts });
  });

  it('asks the Host once, and asks again after a failure', async () => {
    const catalog = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(host);
    const { c } = setup({ catalog });
    expect(await c.call('chat.Catalog', [])).toMatchObject({ commands: [], canSwitchModel: false });
    await c.call('chat.Catalog', []);
    await c.call('chat.Catalog', []);
    expect(catalog).toHaveBeenCalledTimes(2);
  });

  it('offers the picker command, not a typed switch, where the agent has only a picker', async () => {
    const { c } = setup({ catalog: vi.fn().mockResolvedValue({ ...host, modelVerb: undefined, modelPicker: '/model' }) });
    expect((await c.call('chat.Catalog', [])) as { canSwitchModel: boolean }).toMatchObject({ canSwitchModel: false, modelPicker: '/model' });
    await expect(c.call('chat.SwitchModel', ['x'])).rejects.toThrow(/picker/);
  });

  it('switches by sending the agent\'s own typed command', async () => {
    const { c, ops } = setup({ catalog: vi.fn().mockResolvedValue(host) });
    await c.call('chat.SwitchModel', [' anthropic/sonnet ']);
    expect(ops.send).toHaveBeenCalledWith('/model anthropic/sonnet', false);
    await expect(c.call('chat.SwitchModel', ['a\nb'])).rejects.toThrow(/Invalid/);
    await expect(c.call('chat.SwitchModel', [''])).rejects.toThrow(/Invalid/);
  });
});

describe('follow-up queue', () => {
  const working = (over: Partial<ChatFrame> = {}) => frame({ agentStatus: 'working', ...over });

  it('is off until the Host serves it, and a working agent then takes the text through the Mac queue', async () => {
    const off = setup();
    off.c.feed({ phase: 'live', frame: working() });
    expect(off.c.state().features.queue).toBe(false);
    await off.c.call('chat.Send', ['next']);
    expect(off.ops.queue).not.toHaveBeenCalled();
    expect(off.ops.send).toHaveBeenCalledWith('next', false);

    const on = setup({ canQueue: vi.fn().mockReturnValue(true) });
    on.c.feed({ phase: 'live', frame: working() });
    expect(on.c.state().features.queue).toBe(true);
    const state = (await on.c.call('chat.Send', ['next'])) as { queuedItems?: { id: string; text: string; state: string }[] };
    expect(on.ops.queue).toHaveBeenCalledWith('next');
    expect(on.ops.send).not.toHaveBeenCalled();
    expect(state.queuedItems).toEqual([{ id: '', text: 'next', state: 'queued' }]);
  });

  it('a ready agent still gets the text now', async () => {
    const { c, ops } = setup({ canQueue: vi.fn().mockReturnValue(true) });
    c.feed({ phase: 'live', frame: frame() });
    await c.call('chat.Send', ['now']);
    expect(ops.send).toHaveBeenCalledWith('now', false);
    expect(ops.queue).not.toHaveBeenCalled();
  });

  it('shows the Host\'s rows, hands over to them, and cancel-all hides until the frame stops carrying', async () => {
    const { c, ops } = setup({ canQueue: vi.fn().mockReturnValue(true) });
    c.feed({ phase: 'live', frame: working() });
    await c.call('chat.Send', ['next']);
    c.feed({ phase: 'live', frame: working({ queued: { items: [{ id: 'q1', text: 'next', state: 'queued' }] } }) });
    expect(c.state().queuedItems).toEqual([{ id: 'q1', text: 'next', state: 'queued' }]);
    await c.call('chat.CancelQueued', []);
    expect(ops.cancelQueued).toHaveBeenCalled();
    expect(c.state().queuedItems).toBeUndefined();
    // a frame that still carries it (sent before the cancel landed) stays hidden…
    c.feed({ phase: 'live', frame: working({ queued: { items: [{ id: 'q1', text: 'next', state: 'queued' }] } }) });
    expect(c.state().queuedItems).toBeUndefined();
    // …until the Host stops carrying it, after which new ones show again.
    c.feed({ phase: 'live', frame: working() });
    c.feed({ phase: 'live', frame: working({ queued: { items: [{ id: 'q2', text: 'again', state: 'queued' }] } }) });
    expect(c.state().queuedItems).toEqual([{ id: 'q2', text: 'again', state: 'queued' }]);
  });

  it('edits and reorders stacked rows through the Host, drawing them at once until the frame differs', async () => {
    const { c, ops } = setup({ canQueue: vi.fn().mockReturnValue(true), canEdit: vi.fn().mockReturnValue(true) });
    const q1 = { id: 'q1', text: 'first', state: 'queued' };
    const q2 = { id: 'q2', text: 'second', state: 'queued' };
    const q3 = { id: 'q3', text: 'third', state: 'queued' };
    const items = [q1, q2, q3];
    c.feed({ phase: 'live', frame: working({ queued: { items } }) });
    expect(c.state().features).toMatchObject({ edit: true, reorder: true });
    await c.call('chat.EditQueuedItem', ['q2', '  second, edited ']);
    expect(ops.editQueuedItem).toHaveBeenCalledWith('q2', 'second, edited');
    expect(c.state().queuedItems?.map((i) => i.text)).toEqual(['first', 'second, edited', 'third']);
    await c.call('chat.ReorderQueued', ['q3', 0]);
    expect(ops.moveQueuedItem).toHaveBeenCalledWith('q3', 0);
    expect(c.state().queuedItems?.map((i) => i.id)).toEqual(['q3', 'q1', 'q2']);
    // the same frame again keeps the bridge; the Host's own new order replaces it.
    c.feed({ phase: 'live', frame: working({ queued: { items } }) });
    expect(c.state().queuedItems?.map((i) => i.id)).toEqual(['q3', 'q1', 'q2']);
    const hosted = [q3, q1, { ...q2, text: 'second, edited' }];
    c.feed({ phase: 'live', frame: working({ queued: { items: hosted } }) });
    expect(c.state().queuedItems).toEqual(hosted);
  });

  it('keeps the stacked rows when the Host refuses an edit', async () => {
    const { c } = setup({
      canQueue: vi.fn().mockReturnValue(true),
      canEdit: vi.fn().mockReturnValue(true),
      editQueuedItem: vi.fn().mockRejectedValue(new Error('That follow-up is already on its way.')),
    });
    c.feed({ phase: 'live', frame: working({ queued: { items: [{ id: 'q1', text: 'first', state: 'queued' }] } }) });
    await expect(c.call('chat.EditQueuedItem', ['q1', 'x'])).rejects.toThrow('already on its way');
    expect(c.state().queuedItems?.[0]?.text).toBe('first');
  });

  it('cancels one stacked row through the Host, hiding the rows until the frame agrees', async () => {
    const { c, ops } = setup({ canQueue: vi.fn().mockReturnValue(true) });
    c.feed({
      phase: 'live',
      frame: working({ queued: { items: [
        { id: 'q1', text: 'first', state: 'queued' },
        { id: 'q2', text: 'second', state: 'queued' },
      ] } }),
    });
    expect(c.state().queuedItems).toEqual([
      { id: 'q1', text: 'first', state: 'queued' },
      { id: 'q2', text: 'second', state: 'queued' },
    ]);
    await c.call('chat.CancelQueuedItem', ['q1']);
    expect(ops.cancelQueuedItem).toHaveBeenCalledWith('q1');
    expect(ops.cancelQueued).not.toHaveBeenCalled();
    expect(c.state().queuedItems).toBeUndefined();
    // a frame that still carries the survivor stays hidden until the Host's next word.
    c.feed({ phase: 'live', frame: working({ queued: { items: [{ id: 'q2', text: 'second', state: 'queued' }] } }) });
    expect(c.state().queuedItems).toBeUndefined();
  });

  it('drops the local chip once the agent is no longer working', async () => {
    const { c } = setup({ canQueue: vi.fn().mockReturnValue(true) });
    c.feed({ phase: 'live', frame: working() });
    await c.call('chat.Send', ['next']);
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state().queuedItems).toBeUndefined();
  });

  it('says so when a queued follow-up did not go through', () => {
    const uncertain = toPageState({ paneId: 'p', seq: 1, frame: working({ queued: { items: [{ id: 'q1', text: 'x', state: 'delivery-uncertain' }] } }) });
    expect(uncertain.queuedItems).toBeUndefined();
    expect(uncertain.outcome).toMatch(/may or may not/);
    const failed = toPageState({ paneId: 'p', seq: 1, frame: working({ queued: { items: [{ id: 'q2', text: 'x', state: 'failed-recoverable', detail: 'agent busy' }] } }) });
    expect(failed.outcome).toMatch(/agent busy/);
  });

  it('a refusal reaches the page as its sentence', async () => {
    const { c } = setup({ canQueue: vi.fn().mockReturnValue(true), queue: vi.fn().mockRejectedValue(new Error('An earlier follow-up may not have been delivered. Check the agent before queueing more.')) });
    c.feed({ phase: 'live', frame: working() });
    await expect(c.call('chat.Send', ['x'])).rejects.toThrow('may not have been delivered');
  });
});

describe('review changes', () => {
  it('is off without a Git view, and the page then has no review button', async () => {
    const { c, ops } = setup();
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state()).not.toHaveProperty('canReview');
    await c.call('chat.ReviewChanges', ['a.go']);
    expect(ops.review).not.toHaveBeenCalled();
  });

  it('with one, the card and its file links open the phone Git view', async () => {
    const { c, ops } = setup({ canReview: vi.fn().mockReturnValue(true) });
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state().canReview).toBe(true);
    await c.call('chat.ReviewChanges', ['']);
    await c.call('chat.ReviewChanges', ['src/a.go']);
    expect(ops.review).toHaveBeenNthCalledWith(1, '');
    expect(ops.review).toHaveBeenNthCalledWith(2, 'src/a.go');
  });

  it('hands the page the changed-file count for its pill', () => {
    const { c } = setup({ canReview: vi.fn().mockReturnValue(true), changedFiles: vi.fn().mockReturnValue(3) });
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state().changedFiles).toBe(3);
    expect(toPageState({ paneId: 'p', seq: 1, frame: null, canReview: true, changedFiles: 2 }).changedFiles).toBe(2);
  });

  it.each([
    ['without a Git view', false, 3],
    ['at zero', true, 0],
    ['while the status is unknown', true, undefined],
  ])('shows no count %s', (_name, canReview, count) => {
    const { c } = setup({ canReview: vi.fn().mockReturnValue(canReview), changedFiles: vi.fn().mockReturnValue(count) });
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state()).not.toHaveProperty('changedFiles');
  });
});

describe('@ file completion', () => {
  it('asks the Host for the pane folder\'s entries and passes them to the page', async () => {
    const { c, ops } = setup({ files: vi.fn().mockResolvedValue(['README.md', 'src/']) });
    expect(await c.call('chat.ListFiles', ['re'])).toEqual(['README.md', 'src/']);
    expect(ops.files).toHaveBeenCalledWith('re');
  });

  it('shows no suggestions, not an error, when the Host cannot answer', async () => {
    const { c } = setup({ files: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await c.call('chat.ListFiles', ['re'])).toEqual([]);
  });
});

describe('earlier messages', () => {
  it('shows the button only while the Host window has an earlier page, and asks the stream for it', async () => {
    const { c, ops } = setup();
    c.feed({ phase: 'live', frame: frame() });
    expect(c.state()).not.toHaveProperty('hasOlder');
    const older = frame();
    older.state = { ...older.state, hasOlder: true };
    c.feed({ phase: 'live', frame: older });
    expect(c.state().hasOlder).toBe(true);
    await c.call('chat.Older', []);
    expect(ops.older).toHaveBeenCalledTimes(1);
  });
});

describe('context window', () => {
  it('answers the context card with the window the Host states, and used alone when it states none', async () => {
    const { c } = setup();
    const f = frame();
    f.state = { ...f.state, contextTokens: 190_000 };
    c.feed({ phase: 'live', frame: f });
    expect(await c.call('chat.ContextUsage', [])).toMatchObject({ used: 190_000, window: 0 });
    const withWindow = frame();
    withWindow.state = { ...withWindow.state, contextTokens: 190_000, contextWindow: 200_000 };
    c.feed({ phase: 'live', frame: withWindow });
    expect(await c.call('chat.ContextUsage', [])).toMatchObject({ used: 190_000, window: 200_000 });
  });
});
