# Review Detail Unified Fields Design

## Goal

Unify hand detail fields and layout across three flows:

- Quick entry expanded details.
- AI voice recognition confirmation and backfill.
- Hand review detail display and edit pages.

The same field model should drive all three surfaces. The surfaces differ only by mode: empty-field behavior, editability, and whether the AI confirmation panel is active.

## Field Set

The canonical hand detail fields are:

- Date
- Stake level
- Player count
- Straddle enabled
- Hero position
- Villain position
- Villain type
- Effective stack
- Current pot
- Hand profit
- Opponent nickname
- Opponent hand / Showdown
- Hero cards
- Action summary
- Mind journey
- Hero question
- Street details
- Tags
- AI advice

Street details use full Chinese street names, not abbreviations:

- 翻前: pot and action line.
- 翻牌: board cards, pot, and action line.
- 转牌: board card, pot, and action line.
- 河牌: board card, pot, and action line.

## Straddle Rules

Straddle is a checkbox and defaults to off.

When straddle is off:

- `STR` is not available in position selectors.
- BB displays and statistics use the stake level big blind.

When straddle is on:

- `STR` becomes available in position selectors.
- Straddle amount is automatically `bigBlind * 2`.
- No separate straddle amount input is shown.
- Profit BB, result BB, and statistics still use the stake level big blind.
- AI review requests include `hasStraddle=true` and the computed `straddleAmount`.

## Page Modes

### Quick Entry Default

Only Hero cards and hand profit are required. Expanded detail fields are hidden.

### Quick Entry Expanded

Show the full canonical field form. All fields are editable. Empty values are allowed.

### Review Detail Initial

If a hand only has quick-entry data, show the top summary and voice review entry. Do not show a full empty detail form before AI recognition.

### AI Recognition Confirmation

Show the full canonical field form as the confirmation surface. Users can correct recognized values before backfill. While this panel is active, do not also show a duplicate full read-only detail section.

### Backfilled Review Detail

After confirmation:

- Save the backfilled fields.
- Collapse the AI recognition panel by default.
- Show the canonical detail page in read-only mode.
- Show all fields. Empty fields render as `-`.

### Edit Detail

When entering from review-list edit actions or the full detail edit path:

- Show the same canonical field page.
- Show all fields.
- All editable fields are editable.
- Empty fields remain visible and can be filled.

## Implementation Direction

Create a shared field schema and view-model builder for hand detail fields. The shared layer should define:

- Field order and labels.
- Field type: text, number, date, select, checkbox, cards, street group, textarea.
- Empty display value, defaulting to `-` in read-only mode.
- Editability by mode.
- Position options filtered by `hasStraddle`.

The existing pages should consume this shared model instead of maintaining independent field lists. This prevents quick entry, AI confirmation, read-only detail, and edit detail from drifting apart.

## AI Review Inputs

AI review should receive the canonical field payload, including:

- Full street details.
- `hasStraddle` and computed `straddleAmount`.
- Opponent hand / showdown when recognized.
- Hero question, so the advice can answer the user's specific concern.

If the user does not mention opponent hand or Hero question, those fields remain empty and display as `-` after backfill.

## Acceptance Criteria

- Quick entry expanded details, AI confirmation, read-only detail, and edit detail use the same field order and labels.
- `STR` is unavailable until straddle is checked.
- Checking straddle computes `bigBlind * 2` for AI context without changing BB statistics.
- AI confirmation and read-only detail are not shown as duplicate full forms at the same time.
- After backfill, the AI panel is collapsed and the detail page shows all fields with `-` for empty values.
- Edit mode shows the same fields as read-only mode, but editable.
