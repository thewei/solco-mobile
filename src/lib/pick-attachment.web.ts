// [INPUT]: the browser's file chooser through expo-document-picker (which hands back a DOM `File`).
// [OUTPUT]: `pickAttachment()` — same contract as the native module.
// [POS]: Web/PWA twin of `pick-attachment.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import * as DocumentPicker from 'expo-document-picker';

import { ATTACHMENT_TOO_LARGE, MAX_ATTACHMENT_BYTES, type PickedAttachment } from '@/lib/attachment';

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(file);
  });
}

export async function pickAttachment(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset?.file) return null;
  if (asset.file.size > MAX_ATTACHMENT_BYTES) throw new Error(ATTACHMENT_TOO_LARGE);
  return { dataBase64: await readBase64(asset.file), mime: asset.mimeType ?? asset.file.type, name: asset.name };
}
