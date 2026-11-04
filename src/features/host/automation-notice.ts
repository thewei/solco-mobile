// [INPUT]: an `automation` frame of the Host's events socket (kind draft|started|done|failed, name, runId).
// [OUTPUT]: automationNotice(frame) → the NotificationRequest the bridge schedules.
// [POS]: The phone's wording of an automation step, the desktop's own words (solco nativeui
//        automations_notify.go): the name and the step, never a prompt, rationale or error. One
//        identifier per automation (`solco-automation/<name>`, the desktop's id), so a later step
//        replaces the earlier one instead of stacking. A tap opens the read-only Automations screen
//        (`/automations`). Pure, tested.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { EventMessage } from '@/contracts/host-v3';

import type { NotificationRequest } from '@/features/host/attention-delivery';

export type AutomationFrame = Extract<EventMessage, { t: 'automation' }>;

export const AUTOMATION_NOTIFICATION_PREFIX = 'solco-automation/';

/** The tap handler reads `route` as a JSON-encoded Href (the same shape the pane notifications carry). */
const ROUTE = JSON.stringify('/automations');

const STEP_BODY = { started: 'Started', done: 'Finished', failed: 'Failed' } as const;

export function automationNotice(frame: AutomationFrame): NotificationRequest {
  const identifier = `${AUTOMATION_NOTIFICATION_PREFIX}${frame.name}`;
  if (frame.kind === 'draft') {
    return { identifier, title: 'Draft needs approval', body: frame.name, data: { route: ROUTE, automation: frame.name } };
  }
  return { identifier, title: frame.name, body: STEP_BODY[frame.kind], data: { route: ROUTE, automation: frame.name, ...(frame.runId ? { runId: frame.runId } : {}) } };
}
