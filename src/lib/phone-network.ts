// [INPUT]: expo-network's connection type.
// [OUTPUT]: readPhoneNetwork() → 'wifi' | 'cellular' | 'other' | 'unknown'.
// [POS]: the phone's network kind at the moment it reached a Mac, stored on that Mac's card. Needs no
//        permission beyond ACCESS_NETWORK_STATE and never reads an SSID, an IP or a location; any
//        failure reads as 'unknown'. Imported lazily so Node tests and Web never load the module.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { PhoneNetwork } from '@/lib/host-book';

export async function readPhoneNetwork(): Promise<PhoneNetwork> {
  try {
    const Network = await import('expo-network');
    const { type } = await Network.getNetworkStateAsync();
    switch (type) {
      case Network.NetworkStateType.WIFI:
        return 'wifi';
      case Network.NetworkStateType.CELLULAR:
        return 'cellular';
      case Network.NetworkStateType.NONE:
      case Network.NetworkStateType.UNKNOWN:
      case undefined:
        return 'unknown';
      default:
        return 'other';
    }
  } catch {
    return 'unknown';
  }
}
