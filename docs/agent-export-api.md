# Agent Export API

This read-only interface is for external agents that need poker results and hand details for weekly reports, knowledge-base sync, and review summaries.

## Cloud Function Action

Use the existing `poker_data` cloud function with action `agent_export`.

External HTTP callers must send a bearer token:

```bash
curl -X POST "$POKER_DATA_HTTP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_EXPORT_TOKEN" \
  -d '{
    "action": "agent_export",
    "playerId": "WX-0V0I0SH",
    "rangeKey": "last7"
  }'
```

Required cloud environment variables:

- `AGENT_EXPORT_TOKEN`: shared secret for external agents.
- `AGENT_EXPORT_OWNER_OPENID`: the WeChat owner openid this token can read.

Do not let callers pass `ownerOpenId`; it is bound server-side through `AGENT_EXPORT_OWNER_OPENID`.

## Request Fields

- `action`: must be `agent_export`.
- `playerId`: required player id, for example `WX-0V0I0SH`.
- `rangeKey`: optional, one of `last7`, `last30`, `all`; default is `last7`.
- `range`: optional custom range `{ "from": "2026-06-24", "to": "2026-06-30" }`.
- `nowMs`: optional test/automation timestamp override.

## Response Shape

The cloud function returns `{ "code": 0, "data": ... }`.

`data` includes:

- `summary`: session count, hand count, total finished-session profit, hand-profit sum, total hours, hourly rate, win/loss hand counts.
- `extremes.biggestWinningHand`: the highest positive-profit hand in the selected range.
- `extremes.biggestLosingHand`: the lowest negative-profit hand in the selected range.
- `sessions`: filtered session details.
- `hands`: filtered hand details, newest first, with cards, board, positions, opponent info, pot, profit, tags, review fields, All-in EV fields, AI review, voice extract, and ordered actions.
- `bankrollLogs`: filtered bankroll logs.
- `fieldNotes`: short metric definitions for downstream summaries.

For weekly knowledge-base sync, use `rangeKey: "last7"` or an explicit Monday-Sunday `range`.

Custom weekly range example:

```json
{
  "action": "agent_export",
  "playerId": "WX-0V0I0SH",
  "range": {
    "from": "2026-06-22",
    "to": "2026-06-28"
  }
}
```

Machine-readable response schema: `docs/agent-export-schema.json`.

## Agent Client Script

Agents that can run Node.js 18+ can use the bundled client:

```bash
set POKER_DATA_HTTP_URL=https://example.com/poker_data
set AGENT_EXPORT_TOKEN=replace-with-secret
set POKER_AGENT_PLAYER_ID=WX-0V0I0SH
node tools/agent-export-client.js --range last7
```

Explicit weekly range:

```bash
node tools/agent-export-client.js --from 2026-06-22 --to 2026-06-28
```

## Deployment Healthcheck

After the cloud function is deployed and the HTTP trigger URL is available, run:

```bash
set POKER_DATA_HTTP_URL=https://example.com/poker_data
set AGENT_EXPORT_TOKEN=replace-with-secret
set POKER_AGENT_PLAYER_ID=WX-0V0I0SH
node tools/agent-export-healthcheck.js
```

The healthcheck exits with code `0` only when the endpoint returns `summary.totalProfit`, `summary.handCount`, `extremes.biggestWinningHand`, `extremes.biggestLosingHand`, and a `hands` array.
