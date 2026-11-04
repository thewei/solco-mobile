import { describe, expect, it } from 'vitest';

import type { TreeWorkspace } from '@/contracts/host-v3';

import { pickWorkspace } from './project-model';

const ws = (id: string, status = 'idle'): TreeWorkspace => ({ id, label: id, status, tabs: [] });

describe('pickWorkspace', () => {
  it('has nothing to pick from an empty tree', () => {
    expect(pickWorkspace([], 'a')).toBeNull();
  });
  it('keeps the user’s choice while it exists', () => {
    expect(pickWorkspace([ws('a', 'blocked'), ws('b')], 'b')?.id).toBe('b');
  });
  it('falls back to the one that needs you, then the working one, then the first', () => {
    expect(pickWorkspace([ws('a'), ws('b', 'working'), ws('c', 'blocked')], 'gone')?.id).toBe('c');
    expect(pickWorkspace([ws('a'), ws('b', 'working')], null)?.id).toBe('b');
    expect(pickWorkspace([ws('a'), ws('b')], undefined)?.id).toBe('a');
  });
});
