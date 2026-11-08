import { describe, expect, it } from 'vitest';

import { NO_LAUNCH_PICK, parseLaunchPick, serializeLaunchPick } from './launch-pick';

describe('launch pick codec', () => {
  it('round-trips an agent pick and a terminal pick', () => {
    for (const pick of [
      { agent: 'claude', terminal: false },
      { agent: null, terminal: true },
    ]) {
      expect(parseLaunchPick(serializeLaunchPick(pick))).toEqual(pick);
    }
  });

  it('treats anything unreadable as no pick', () => {
    for (const raw of [undefined, null, '', 'not json', '[]', '{}', '{"agent":3,"terminal":false}', '{"agent":"","terminal":false}', '{"agent":"x"}']) {
      expect(parseLaunchPick(raw)).toEqual(NO_LAUNCH_PICK);
    }
  });

  it('drops fields it does not know', () => {
    expect(serializeLaunchPick({ agent: 'codex', terminal: false, extra: 1 } as never)).toBe('{"agent":"codex","terminal":false}');
  });
});
