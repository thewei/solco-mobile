import { describe, expect, it } from 'vitest';
import { assistantPushRoute } from './system-push-route';

describe('Android OS push cold-start navigation', () => {
  const valid = JSON.stringify({ pathname: '/assistants/activity/[id]', params: { id: 'a_1234' } });
  it('accepts the narrow verified Activity route', () => {
    expect(assistantPushRoute({route:valid})).toEqual({
      pathname:'/assistants/activity/[id]', params:{id:'a_1234'},
    });
  });
  it('rejects unrelated routes and invalid ids rather than trusting remote data', () => {
    for (const raw of [
      '', '{', '"/assistants/activity/a_1234"',
      JSON.stringify({ pathname:'/chat/[paneId]', params:{paneId:'w1:p1'} }),
      JSON.stringify({ pathname:'/assistants/activity/[id]', params:{id:'../evil'} }),
      JSON.stringify({ pathname:'/assistants/activity/[id]', params:{id:3} }),
      JSON.stringify({ pathname:'/assistants/activity/[id]', params:{id:'a_'+'x'.repeat(100)} }),
    ]) {
      expect(assistantPushRoute({route:raw})).toBeNull();
    }
    expect(assistantPushRoute(null)).toBeNull();
  });
});

describe('system push Mac ownership', () => {
  it('recognizes only a pinned Mac public hostId', async () => {
    const { assistantPushHostId } = await import('./system-push-route');
    expect(assistantPushHostId({ hostId: 'abcdef0123456789' })).toBe('abcdef0123456789');
    expect(assistantPushHostId({ hostId: '../mac' })).toBeNull();
    expect(assistantPushHostId({ hostId: 'abcdef0123456789extra' })).toBeNull();
    expect(assistantPushHostId({ hostId: 'xxx' })).toBeNull();
    expect(assistantPushHostId({})).toBeNull();
  });
});
