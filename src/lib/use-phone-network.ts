// [INPUT]: lib/phone-network's one-shot read.
// [OUTPUT]: usePhoneNetwork() → the phone's network kind ('unknown' until read).
// [POS]: lets an error page say what the phone was on when a Mac could not be reached.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useState } from 'react';

import type { PhoneNetwork } from '@/lib/host-book';
import { readPhoneNetwork } from '@/lib/phone-network';

export function usePhoneNetwork(): PhoneNetwork {
  const [network, setNetwork] = useState<PhoneNetwork>('unknown');
  useEffect(() => {
    let active = true;
    void readPhoneNetwork().then((value) => {
      if (active) setNetwork(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return network;
}
