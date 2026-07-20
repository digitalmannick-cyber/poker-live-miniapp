# Poker Data Generation Fence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every pre-clear `poker_data` business operation from recreating private data after `clear_all_data` begins, while allowing new operations immediately after a successful clear.

**Architecture:** A deterministic `poker_data_account_lifecycle` document owns `{ ownerOpenId, playerId, state, generation }`. Every request that may write business data captures the active generation, and every actual business `set/remove` re-reads the lifecycle document inside the same CloudBase transaction before mutating. Clear atomically advances to `clearing(generation + 1)`, performs convergent deletion without the normal fence, and returns to `active` at that generation; retries with the same mutation resume or restore without advancing twice.

**Tech Stack:** Node.js, WeChat CloudBase `wx-server-sdk`, `node:test`.

## Global Constraints

- Never treat an entrypoint point-read or the `sync_operations` claim transaction as the business-write fence.
- `sync_operations` and `audit_logs` may bypass the fence only for payload-free integrity metadata; recovery evidence and mutation results containing business payload must be fenced.
- Do not commit or upload.

---

### Task 1: Lifecycle state machine and concurrency contract

**Files:**
- Modify: `cloudfunctions/poker_data/index.js`
- Test: `tests/poker-data-account-lifecycle.test.js`

**Interfaces:**
- Produces: `captureAccountLifecycle(ownerOpenId, playerId) -> { docId, ownerOpenId, playerId, generation }`
- Produces: `runFencedBusinessTransaction(fence, callback)`
- Produces: `beginAccountClear(ownerOpenId, playerId, clientMutationId)` and `completeAccountClear(clearFence)`

- [ ] Write failing tests proving active capture, old-generation rejection during clearing and after completion, new-generation acceptance, same-mutation clear retry, and competing-clear rejection.
- [ ] Run `node --test tests/poker-data-account-lifecycle.test.js` and verify failures are caused by absent lifecycle fencing.
- [ ] Add the deterministic lifecycle document and minimal state-machine helpers.
- [ ] Re-run the focused test to green.

### Task 2: Fence every business write surface

**Files:**
- Modify: `cloudfunctions/poker_data/index.js`
- Test: `tests/poker-data-account-lifecycle.test.js`
- Test: `tests/poker-data-write-fence-contract.test.js`

**Interfaces:**
- Consumes: the Task 1 generation fence.
- Produces: fenced set/remove helpers used by session, hand, action, player-note, receipt, profile, settings, bankroll and sync-import writes.

- [ ] Add a failing action matrix for all `runMutation` writers, receipt transactions, login/sync/save/backfill, and each hand revision stage.
- [ ] Add static coverage assertions that no business collection is written through an unfenced helper.
- [ ] Run the two focused tests and verify RED.
- [ ] Thread one captured fence through each operation and place the lifecycle point-read in every transaction that performs a business set/remove.
- [ ] Fence recovery evidence, mutation result and audit writes whenever they contain business payload.
- [ ] Re-run focused tests to green.

### Task 3: Clear integration and deployment contract

**Files:**
- Modify: `cloudfunctions/poker_social/database-security.json`
- Modify: `cloudfunctions/poker_social/database-indexes.json`
- Modify: `cloudfunctions/poker_social/database-indexes.md`
- Test: `tests/social-database-deployment-contract.test.js`
- Test: `tests/player-card-import-receipt-cloud.test.js`

**Interfaces:**
- Consumes: clear lifecycle state machine.
- Produces: server-only deterministic lifecycle collection declaration.

- [ ] Add failing deployment and clear retry tests.
- [ ] Declare the lifecycle collection server-only and deterministic point-read only.
- [ ] Integrate begin/resume/complete around the convergent clear loop.
- [ ] Run focused tests, then poker-data and deployment regressions.

