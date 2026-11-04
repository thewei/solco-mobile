import { describe, expect, it } from 'vitest';

import { automationNotice } from '@/features/host/automation-notice';

describe('automationNotice', () => {
  it('words each step with the name and nothing else, like the desktop', () => {
    expect(automationNotice({ t: 'automation', kind: 'started', name: 'recap', runId: 'r1' })).toMatchObject({ title: 'recap', body: 'Started' });
    expect(automationNotice({ t: 'automation', kind: 'done', name: 'recap', runId: 'r1' })).toMatchObject({ title: 'recap', body: 'Finished' });
    expect(automationNotice({ t: 'automation', kind: 'failed', name: 'recap', runId: 'r1' })).toMatchObject({ title: 'recap', body: 'Failed' });
    expect(automationNotice({ t: 'automation', kind: 'draft', name: 'recap' })).toMatchObject({ title: 'Draft needs approval', body: 'recap' });
  });

  it('opens the Automations screen on tap', () => {
    const route = automationNotice({ t: 'automation', kind: 'done', name: 'recap', runId: 'r1' }).data.route;
    expect(JSON.parse(route as string)).toBe('/automations');
  });

  it('keys one notification per automation so a later step replaces the earlier', () => {
    const a = automationNotice({ t: 'automation', kind: 'started', name: 'recap', runId: 'r1' });
    const b = automationNotice({ t: 'automation', kind: 'done', name: 'recap', runId: 'r1' });
    expect(a.identifier).toBe('solco-automation/recap');
    expect(b.identifier).toBe(a.identifier);
  });
});
