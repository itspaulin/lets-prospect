import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addTarget } from './campaigns.js';
import { approveMessage, draftAll } from './messages.js';
import { sendApproved } from './send.js';
import { outreachSetup, qualifiedCompany } from '../../testing/outreach.js';

test('reports each outcome and stops between messages without touching the rest', async () => {
  const setup = outreachSetup();
  const { deps, campaign } = setup;
  qualifiedCompany(deps, { name: 'Beta', website: 'beta.io' }, 'jane@beta.io');
  addTarget(deps, campaign, 'beta.io');
  for (const message of draftAll(deps, campaign).drafted) approveMessage(deps, message.id);

  const events: string[] = [];
  let stop = false;
  const report = await sendApproved(deps, campaign, {
    onEvent: (event) => {
      events.push(event.type === 'outcome' ? event.outcome.outcome : 'waiting');
      if (event.type === 'waiting') stop = true;
    },
    shouldStop: () => stop,
  });

  assert.deepEqual(events, ['sent', 'waiting']);
  assert.equal(report.outcomes.length, 1);
  assert.equal(setup.email.sent.length, 1);
  assert.equal(deps.store.messages.list({ statuses: ['approved'] }).length, 1);
});
