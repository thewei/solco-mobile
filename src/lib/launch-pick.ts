// [INPUT]: the raw text a storage twin read back (anything, including nothing or garbage).
// [OUTPUT]: `LaunchPick` (the Home composer's last Agent/Terminal choice), `parseLaunchPick`, `serializeLaunchPick`.
// [POS]: pure codec between the session store and `launch-pick-storage` (native file / web localStorage). A harmless UI preference — never a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: unreadable input is "no pick" (never throws); the agent id is only a hint — the composer re-validates it against the Host's kind list.
import { z } from 'zod';

const pickSchema = z.object({
  agent: z.string().min(1).max(64).nullable(),
  terminal: z.boolean(),
});

export type LaunchPick = z.infer<typeof pickSchema>;

export const NO_LAUNCH_PICK: LaunchPick = { agent: null, terminal: false };

export function parseLaunchPick(raw: string | null | undefined): LaunchPick {
  if (!raw) return NO_LAUNCH_PICK;
  try {
    const parsed = pickSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : NO_LAUNCH_PICK;
  } catch {
    return NO_LAUNCH_PICK;
  }
}

export function serializeLaunchPick(pick: LaunchPick): string {
  return JSON.stringify({ agent: pick.agent, terminal: pick.terminal });
}
