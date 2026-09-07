import test from 'node:test';
import assert from 'node:assert/strict';
import { run, resumePrompt } from '../session-handoff.mjs';

const NOW = 1800000000000; // Synthetic deterministic host-clock fixture.
const mission = 'Keep this exact mission.\n  Preserve spacing and café.';
const environment = { workspaceId: 'workspace-1', permissions: { sandbox: 'restricted', approval: 'ask' } };
const snapshot = { workspace: { id: 'workspace-1', revision: 'head-a', dirty: ['unsaved.md'] },
  artifacts: [{ id: 'unsaved.md', sha256: 'a'.repeat(64) }] };
const context = (sessionId = 'owner-a', overrides = {}) => ({ sessionId, source: 'synthetic-host-resident-context', observedAt: NOW,
  effectiveWindowTokens: 1000, compactionBoundariesTokens: [950, 900], usedTokens: 400,
  nextStepTokens: 100, handoffReserveTokens: 100, ...overrides });
const evidence = extra => ({ source: 'synthetic-independent-host', observedAt: NOW, independent: true, ...extra });
const arm = (extra = {}) => run({ state: null, expectedRevision: 0, op: 'arm', sessionId: 'owner-a', now: NOW,
  explicit: true, chainId: 'chain-1', mission, environment, ...extra }).then(r => r.state);
const step = (state, op, extra = {}) => run({ state, expectedRevision: state.revision, sessionId: state.owner,
  now: NOW, maxAgeMs: 60000, op, ...extra });
async function checkpoint(extra = {}) {
  let state = await arm(extra);
  state = (await step(state, 'wind_down', { reason: 'explicit checkpoint' })).state;
  state = (await step(state, 'checkpoint', { body: 'Full checkpoint with exact next action and evidence.', snapshot })).state;
  return state;
}
async function durable(extra = {}) {
  const state = await checkpoint(extra);
  return (await step(state, 'readback', { evidence: evidence({ kind: 'storage_readback',
    checkpointHash: state.checkpoint.hash, content: state.checkpoint.content }) })).state;
}
const reserve = (state, extra = {}) => step(state, 'reserve', { mode: 'new', nonce: '1'.repeat(32), snapshot,
  writersQuiesced: true, reviewSkipReason: 'Synthetic fixture: reviewer unavailable.', ...extra }).then(r => r.state);
async function created(extra = {}) {
  let state = await reserve(await durable(extra));
  return (await step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'created', evidence: evidence({
    kind: 'host_session', sessionId: 'candidate-b', status: 'starting', nonce: state.reservation.nonce }) })).state;
}
function readiness(state) {
  const candidateId = state.reservation.candidateId;
  const bound = { nonce: state.reservation.nonce, checkpointHash: state.checkpoint.hash, snapshot,
    environment: state.environment, sessionId: candidateId };
  return { context: context(candidateId), hostEvidence: evidence({ ...bound, kind: 'host_session', status: 'ready', checkpointReadAt: NOW,
    goalEvidence: state.goal === null ? null : { sessionId: candidateId, goal: state.goal, status: 'active', createdAt: NOW, inspectedAt: NOW } }),
  acknowledgment: evidence({ ...bound, readComplete: true, firstAction: 'Read the governing tracker.',
    mission: state.mission, goal: state.goal, goalBudgetExplicit: state.goalBudgetExplicit }) };
}
async function attested(extra = {}) {
  const state = await created(extra);
  return (await step(state, 'attest', readiness(state))).state;
}
function transferInput(state) {
  return { ...readiness(state), candidateId: state.reservation.candidateId, nonce: state.reservation.nonce,
    checkpointHash: state.checkpoint.hash, writersQuiesced: true, snapshot };
}
function reviewInput(state, extra = {}) {
  return { context: context(), budgetMs: 180000, evidence: evidence({ kind: 'external_review', reviewerSessionId: 'reviewer-c',
    status: 'completed', timedOut: false, permissionDenied: false,
    readOnly: true, authorityUnchanged: true, checkpointHash: state.checkpoint.hash, durationMs: 1000,
    verdict: 'durable', output: Array.from({ length: 7 }, (_, i) => `${i + 1}. Actual synthetic finding.`).join('\n') + '\nVERDICT: DURABLE\n',
    findings: ['mission', 'next_steps', 'evidence', 'completeness', 'landmines', 'authority', 'confidence']
      .map(criterion => ({ criterion, result: 'pass', detail: 'Synthetic criterion evidence was inspected.' })), ...extra }) };
}

test('one full transfer preserves exact authority and leaves predecessor inert', async () => {
  const goal = { objective: 'An exact\n goal,  with spacing.', token_budget: 9876, metadata: { preserved: true } };
  const start = await attested({ goal, goalBudgetExplicit: true });
  const before = JSON.stringify(start);
  const { state, result } = await step(start, 'transfer', transferInput(start));
  assert.equal(JSON.stringify(start), before, 'input state is never mutated');
  assert.equal(state.owner, 'candidate-b');
  assert.equal(state.generation, 1);
  assert.equal(state.attempts, 1);
  assert.equal(state.phase, 'owned');
  assert.equal(state.reservation, null);
  assert.equal(state.mission, mission);
  assert.deepEqual(state.goal, goal);
  assert.deepEqual(state.environment, environment);
  assert.equal(result.predecessorMustStop, true);
  await assert.rejects(step(state, 'wind_down', { sessionId: 'owner-a', reason: 'stale predecessor' }), /does not own/);
  assert.equal((await step(state, 'check', { context: context('candidate-b') })).result.decision, 'continue');
});

test('activation requires explicit authority and never invents a token budget or goal', async () => {
  await assert.rejects(arm({ explicit: false }), /explicit mission/);
  await assert.rejects(arm({ goal: { objective: 'x', token_budget: 100 } }), /explicit user authority/);
  await assert.rejects(arm({ goalBudgetExplicit: true }), /requires a token budget/);
  for (const token_budget of [0, -1, '100', true, 1.5]) {
    await assert.rejects(arm({ goal: { objective: 'x', token_budget }, goalBudgetExplicit: true }), /token budget/);
  }
  assert.equal((await arm()).goal, null);
  assert.equal((await arm()).cap, 5);
  assert.deepEqual((await arm({ goal: { objective: 'x' } })).goal, { objective: 'x' });
  const state = await arm();
  await assert.rejects(step(state, 'arm', { explicit: true }), /absent state/);
});

test('fresh exact-session context uses earliest real boundary and reserves equality', async () => {
  const state = await arm();
  const result = await step(state, 'check', { context: context() });
  assert.equal(result.state.revision, state.revision, 'check is read-only');
  assert.equal(result.result.boundaryTokens, 900);
  assert.equal(result.result.decision, 'continue');
  assert.equal((await step(state, 'check', { context: context('owner-a', { usedTokens: 700 }) })).result.decision, 'handoff');
  assert.equal((await step(state, 'check', { context: context('owner-a', { usedTokens: 900 }) })).result.late, true);
  assert.equal((await step(state, 'check', { context: context('owner-a', { nextStepTokens: 0 }) })).result.decision, 'continue');
  for (const sample of [null, context('wrong'), context('owner-a', { observedAt: NOW + 1 }),
    context('owner-a', { observedAt: NOW - 60001 }), context('owner-a', { usedTokens: '400' }),
    context('owner-a', { usedTokens: 1001 }), context('owner-a', { effectiveWindowTokens: 0 }),
    context('owner-a', { compactionBoundariesTokens: [] }), context('owner-a', { compactionBoundariesTokens: [1001] }),
    context('owner-a', { compactionBoundariesTokens: [false] }), context('owner-a', { nextStepTokens: null }),
    context('owner-a', { handoffReserveTokens: 0 }), context('owner-a', { handoffReserveTokens: true }),
    context('owner-a', { nextStepTokens: Number.MAX_SAFE_INTEGER })]) {
    assert.equal((await step(state, 'check', { context: sample })).result.decision, 'checkpoint_now');
  }
});

test('all mutations use owner and expected revision; evaluation alone is no distributed lock', async () => {
  const state = await arm();
  await assert.rejects(step(state, 'wind_down', { sessionId: 'intruder', reason: 'x' }), /does not own/);
  await assert.rejects(step(state, 'wind_down', { expectedRevision: 0, reason: 'x' }), /stale expected revision/);
  const [a, b] = await Promise.all([step(state, 'wind_down', { reason: 'a' }), step(state, 'wind_down', { reason: 'b' })]);
  assert.equal(a.state.revision, b.state.revision, 'caller must choose one using shared atomic CAS');
  await assert.rejects(step(a.state, 'checkpoint', { expectedRevision: state.revision, body: 'x', snapshot }), /stale expected revision/);
  assert.equal((await step(a.state, 'check', { context: context() })).result.decision, 'stop');
});

test('checkpoint digest is detached, exact, and never reported durable without content readback', async () => {
  const state = await checkpoint();
  assert.equal(state.checkpoint.readback, null);
  assert.match(state.checkpoint.hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(state.checkpoint.content, 'hash'), false);
  await assert.rejects(reserve(state), /durable checkpoint readback/);
  const read = evidence({ kind: 'storage_readback', checkpointHash: state.checkpoint.hash, content: state.checkpoint.content });
  await assert.rejects(step(state, 'readback', { evidence: { ...read, content: { ...read.content, body: 'changed' } } }), /readback content mismatch/);
  await assert.rejects(step(state, 'readback', { evidence: { ...read, observedAt: NOW - 60001 } }), /stale/);
  const good = await step(state, 'readback', { evidence: read });
  assert.equal(good.result.durability, 'confirmed_readback');
  const revised = (await step(good.state, 'checkpoint', { body: 'Corrected checkpoint', snapshot })).state;
  assert.notEqual(revised.checkpoint.hash, state.checkpoint.hash);
  assert.equal(revised.checkpoint.readback, null);
  assert.deepEqual(revised.reviews, []);
  const corrupt = structuredClone(state);
  corrupt.checkpoint.content.body += '!';
  await assert.rejects(step(corrupt, 'check'), /digest mismatch/);
});

test('initial and periodic durable checkpoints preserve owned work and require fresh rotation checkpoint', async () => {
  let state = await arm();
  for (const body of ['Initial durable checkpoint.', 'Periodic checkpoint after meaningful work.']) {
    state = (await step(state, 'checkpoint', { body, snapshot })).state;
    assert.equal(state.phase, 'owned');
    state = (await step(state, 'readback', { evidence: evidence({ kind: 'storage_readback', checkpointHash: state.checkpoint.hash,
      content: state.checkpoint.content }) })).state;
    assert.equal((await step(state, 'check', { context: context() })).result.decision, 'continue');
  }
  state = (await step(state, 'wind_down', { reason: 'Rotate now.' })).state;
  await assert.rejects(reserve(state), /current phase/);
  assert.equal((await step(state, 'check', { context: context() })).result.decision, 'stop');
});

test('review binds seven findings, exact final verdict, bounded rounds, and preserved objections', async () => {
  const state = await durable();
  for (const change of [{ reviewerSessionId: 'owner-a' }, { authorityUnchanged: false }, { readOnly: false },
    { independent: false },
    { status: 'failed' }, { status: null }, { timedOut: true }, { permissionDenied: true }, { error: 'permission denied' }, { exitCode: 1 },
    { output: 'VERDICT: DURABLE\ntrailing narration' }, { output: 'VERDICT: DURABLE' }, { verdict: 'not_durable' }, { durationMs: 180001 },
    { checkpointHash: 'b'.repeat(64) }, { findings: [] }]) {
    await assert.rejects(step(state, 'review', reviewInput(state, change)));
  }
  let reviewed = state;
  for (let i = 0; i < 3; i++) reviewed = (await step(reviewed, 'review', reviewInput(reviewed))).state;
  await assert.rejects(step(reviewed, 'review', reviewInput(reviewed)), /round cap/);
  reviewed = (await step(reviewed, 'checkpoint', { body: 'Corrected checkpoint cannot reset review budget.', snapshot })).state;
  reviewed = (await step(reviewed, 'readback', { evidence: evidence({ kind: 'storage_readback', checkpointHash: reviewed.checkpoint.hash,
    content: reviewed.checkpoint.content }) })).state;
  await assert.rejects(step(reviewed, 'review', reviewInput(reviewed)), /round cap/);
  let urgent = (await step(state, 'review', { ...reviewInput(state), context: null })).state;
  await assert.rejects(step(urgent, 'review', { ...reviewInput(urgent), context: null }), /round cap/);
  const input = reviewInput(state);
  input.evidence.verdict = 'not_durable';
  input.evidence.output = input.evidence.output.replace('VERDICT: DURABLE', 'VERDICT: NOT DURABLE');
  input.evidence.findings[2] = { criterion: 'evidence', result: 'fail', detail: 'Unresolved artifact access.' };
  let unresolved = (await step(state, 'review', input)).state;
  unresolved = (await step(unresolved, 'review', { skipReason: 'Rotate before the boundary.' })).state;
  assert.equal(unresolved.reviews[0].findings[2].detail, 'Unresolved artifact access.');
  assert.equal((await reserve(unresolved)).phase, 'reserved');
  assert.deepEqual(unresolved.environment, environment);
});

test('one reservation survives unknown outcome; confirmed absence consumes cap and forbids nonce reuse', async () => {
  const start = await durable({ cap: 2 });
  await assert.rejects(reserve(start, { writersQuiesced: false }), /quiesced before launch/);
  let state = await reserve(start);
  await assert.rejects(reserve(state, { nonce: '2'.repeat(32) }), /current phase/);
  state = (await step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'unknown', reason: 'Host timed out.' })).state;
  assert.equal(state.attempts, 1);
  assert.ok(state.reservation);
  await assert.rejects(step(state, 'release', { explicit: true, writersQuiesced: true, reason: 'done' }), /unresolved candidate/);
  const absent = evidence({ kind: 'launch_absence', status: 'absent', nonce: state.reservation.nonce, noPendingLaunch: true, candidateId: null });
  await assert.rejects(step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'confirmed_absent', evidence: { ...absent, noPendingLaunch: false } }), /settled launch/);
  state = (await step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'confirmed_absent', evidence: absent })).state;
  assert.equal(state.attempts, 1);
  await assert.rejects(reserve(state), /unique/);
  state = await reserve(state, { nonce: '2'.repeat(32) });
  const last = await step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'confirmed_absent', evidence: {
    ...absent, nonce: state.reservation.nonce } });
  assert.equal(last.result.retryAllowed, false);
  await assert.rejects(reserve(last.state, { nonce: '3'.repeat(32) }), /cap reached/);
});

test('fork eligibility requires measured inherited plus bootstrap headroom and actual candidate recheck', async () => {
  const state = await durable();
  await assert.rejects(reserve(state, { mode: 'fork' }), /evidence source/);
  const forkEvidence = evidence({ kind: 'fork_projection', parentSessionId: state.owner, includesInheritedHistory: true,
    includesBootstrap: true, context: context() });
  for (const change of [{ includesInheritedHistory: false }, { includesBootstrap: false },
    { context: context('owner-a', { usedTokens: 700 }) }, { observedAt: NOW + 1 }]) {
    await assert.rejects(reserve(state, { mode: 'fork', forkEvidence: { ...forkEvidence, ...change } }));
  }
  assert.equal((await reserve(state, { mode: 'fork', forkEvidence })).reservation.mode, 'fork');
  const launched = await created();
  await assert.rejects(step(launched, 'attest', { ...readiness(launched), context: context('candidate-b', { usedTokens: 700 }) }), /headroom/);
});

test('narrative acknowledgment cannot attest identity, goal, context, or changed permissions', async () => {
  const state = await created({ goal: { objective: 'exact goal', token_budget: 100 }, goalBudgetExplicit: true });
  const ready = readiness(state);
  for (const change of [{ mission: state.mission.trim() + ' ' }, { goal: { objective: 'exact goal' } },
    { goalBudgetExplicit: false }, { nonce: '2'.repeat(32) }, { readComplete: false }, { sessionId: 'other' },
    { environment: { ...environment, permissions: { sandbox: 'unrestricted' } } }]) {
    await assert.rejects(step(state, 'attest', { ...ready, acknowledgment: { ...ready.acknowledgment, ...change } }));
  }
  for (const change of [{ independent: false }, { status: 'starting' }, { sessionId: 'other' },
    { goalEvidence: { ...ready.hostEvidence.goalEvidence, sessionId: 'owner-a' } },
    { goalEvidence: { ...ready.hostEvidence.goalEvidence, threadId: 'owner-a' } },
    { goalEvidence: { ...ready.hostEvidence.goalEvidence, status: 'complete' } },
    { goalEvidence: { ...ready.hostEvidence.goalEvidence, inspectedAt: NOW - 1 } },
    { goalEvidence: { ...ready.hostEvidence.goalEvidence, goal: { objective: 'exact goal', token_budget: 101 } } },
    { snapshot: { ...snapshot, workspace: { revision: 'other' } } }]) {
    await assert.rejects(step(state, 'attest', { ...ready, hostEvidence: { ...ready.hostEvidence, ...change } }));
  }
  await assert.rejects(step(state, 'transfer', transferInput(state)), /current phase/);
  await assert.rejects(step(state, 'attest', { ...ready, context: context('candidate-b', { observedAt: NOW - 1 }) }), /predates completed bootstrap/);
  const laterHost = { ...ready.hostEvidence, observedAt: NOW + 2, checkpointReadAt: NOW + 1,
    goalEvidence: { ...ready.hostEvidence.goalEvidence, createdAt: NOW + 1, inspectedAt: NOW + 2 } };
  await assert.rejects(step(state, 'attest', { ...ready, now: NOW + 2, hostEvidence: laterHost }), /acknowledgment must follow bootstrap/);
  const noGoal = await created();
  const added = readiness(noGoal);
  added.hostEvidence.goalEvidence = { goal: { objective: 'invented' }, status: 'active', createdAt: NOW, inspectedAt: NOW };
  await assert.rejects(step(noGoal, 'attest', added), /introduce a successor goal/);
});

test('transfer rechecks snapshot, owner writers, identity, and current candidate readiness', async () => {
  const state = await attested();
  const input = transferInput(state);
  for (const change of [{ writersQuiesced: false }, { candidateId: 'other' }, { nonce: '2'.repeat(32) },
    { checkpointHash: 'b'.repeat(64) }, { snapshot: { ...snapshot, artifacts: [] } },
    { context: null }, { hostEvidence: { ...input.hostEvidence, observedAt: NOW - 60001 } }]) {
    await assert.rejects(step(state, 'transfer', { ...input, ...change }));
  }
  assert.equal((await step(state, 'transfer', input)).state.owner, 'candidate-b');
});

test('recovery requires explicit stopped expected owner and preserves ambiguous candidates', async () => {
  let state = await reserve(await durable());
  state = (await step(state, 'launch_outcome', { nonce: state.reservation.nonce, outcome: 'unknown', reason: 'timeout' })).state;
  const input = { explicit: true, expectedOwner: state.owner, sessionId: 'rescuer',
    evidence: evidence({ kind: 'host_session', sessionId: state.owner, status: 'stopped' }),
    newOwnerEvidence: evidence({ kind: 'host_session', sessionId: 'rescuer', status: 'running', environment }) };
  for (const change of [{ explicit: false }, { expectedOwner: 'wrong' },
    { evidence: { ...input.evidence, status: 'running' } }, { evidence: { ...input.evidence, independent: false } },
    { evidence: { ...input.evidence, observedAt: NOW + 1 } },
    { newOwnerEvidence: { ...input.newOwnerEvidence, environment: {} } }]) {
    await assert.rejects(step(state, 'recover', { ...input, ...change }));
  }
  const recovered = await step(state, 'recover', input);
  assert.equal(recovered.state.owner, 'rescuer');
  assert.deepEqual(recovered.state.reservation, state.reservation);
  assert.equal(recovered.state.attempts, 1);
  await assert.rejects(reserve(recovered.state, { nonce: '2'.repeat(32) }), /current phase/);
  await assert.rejects(step(recovered.state, 'check', { sessionId: 'owner-a' }), /does not own/);
  const active = await arm({ goal: { objective: 'Must be rearmed before any mission work.' } });
  const reconciler = (await step(active, 'recover', { ...input, expectedOwner: active.owner })).state;
  assert.equal(reconciler.phase, 'winding_down');
  assert.equal((await step(reconciler, 'check', { context: context('rescuer') })).result.decision, 'stop');
});

test('released state is terminal and bootstrap text preserves exact goal without executing anything', async () => {
  const state = await durable();
  const prompt = await resumePrompt({ state, checkpointLocation: 'opaque://checkpoint-1' });
  assert.ok(prompt.includes(JSON.stringify(mission)));
  assert.ok(prompt.includes(state.checkpoint.hash));
  assert.ok(prompt.includes('Goal input (exact JSON): null'));
  assert.ok(prompt.includes('do not create a goal'));
  const released = (await step(state, 'release', { explicit: true, writersQuiesced: true, reason: 'User cancelled.' })).state;
  await assert.rejects(step(released, 'check', { context: context() }), /terminal/);
  await assert.rejects(step(released, 'recover', { explicit: true }), /terminal/);
  await assert.rejects(resumePrompt({ state: released, checkpointLocation: 'x' }), /cannot be resumed/);
});

test('JSON trust boundary rejects coercion, getters, cycles, sparse data, and invalid clock', async () => {
  await assert.rejects(run('{'), /must be a JSON object/);
  await assert.rejects(run('{"mission":"first","mission":"second"}'), /must be a JSON object/);
  const cycle = {}; cycle.self = cycle;
  for (const input of [cycle, { get op() { throw Error('do not run getters'); } }, { x: undefined },
    { x: Infinity }, { x: -0 }, { x: [, 1] }, { x: new Date() }]) {
    await assert.rejects(run(input), /session-handoff:/);
  }
  const state = await arm();
  await assert.rejects(step(state, 'wind_down', { now: NOW - 1, reason: 'x' }), /precedes/);
  await assert.rejects(step(state, 'wind_down', { expectedRevision: '1', reason: 'x' }), /envelope/);
  await assert.rejects(run(JSON.stringify({ state, expectedRevision: state.revision, sessionId: state.owner,
    now: NOW, maxAgeMs: 60000, op: 'check', context: context() })), /must be a JSON object/);
});
