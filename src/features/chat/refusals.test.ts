import { describe, expect, it } from 'vitest';

import { refusalText } from '@/features/chat/refusals';

describe('refusalText', () => {
  it('turns Host refusal codes into sentences, relaying Herdr\'s own words', () => {
    expect(refusalText('busy', undefined)).toContain('Send now');
    expect(refusalText('refused', 'agent is busy')).toBe('The agent refused it: agent is busy');
    expect(refusalText(undefined, undefined)).toBe('The message was not sent.');
    expect(refusalText('transcribe_failed', 'auth failed')).toBe('Transcription failed: auth failed');
    expect(refusalText('voice_unavailable', undefined)).toContain('Settings → Voice');
    expect(refusalText('audio_too_large', undefined)).toContain('under a minute');
  });
});
