// [INPUT]: the system document picker (Android Storage Access Framework, which also offers Photos).
// [OUTPUT]: `pickAttachment()` — the chosen file as base64 + MIME + name, or null when the user cancelled.
// [POS]: native picker for Chat attachments; `pick-attachment.web.ts` is the browser twin with the same contract.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: one file at a time; the size is checked from the picker's metadata before the bytes are read.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ATTACHMENT_TOO_LARGE, MAX_ATTACHMENT_BYTES, type PickedAttachment } from '@/lib/attachment';

export async function pickAttachment(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  if (asset.size !== undefined && asset.size > MAX_ATTACHMENT_BYTES) throw new Error(ATTACHMENT_TOO_LARGE);
  const dataBase64 = await new File(asset.uri).base64();
  return { dataBase64, mime: asset.mimeType ?? '', name: asset.name };
}
