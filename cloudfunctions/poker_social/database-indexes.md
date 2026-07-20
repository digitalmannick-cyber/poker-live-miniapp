# `poker_social` database indexes

All social collections are server-only. Configure CloudBase client permissions to deny direct client reads and writes.

## Friendship queries

- `social_friendships`: `userA ASC, status ASC, acceptedAt DESC, _id ASC`
- `social_friendships`: `userB ASC, status ASC, acceptedAt DESC, _id ASC`

## Task 2 hand sharing and authoritative source reads

- `social_users`: `ownerOpenId ASC`
- `hand_actions`: `ownerOpenId ASC, playerId ASC, handId ASC, sequence ASC, _id ASC`
- `hand_actions` (legacy compatibility): `_openid ASC, playerId ASC, handId ASC, sequence ASC, _id ASC`
- `social_hand_shares`: `status ASC, scope ASC, createdAt DESC, _id DESC`
- `social_hand_shares`: `publisherId ASC, status ASC, createdAt DESC, _id DESC`
- `social_hand_shares`: `targetUserIds ARRAY, status ASC, createdAt DESC, _id DESC`
- `social_hand_share_slots`: deterministic `_id` point-read only
- `social_rate_limits`: deterministic `_id` point-read only
- `social_notification_outbox`: `status ASC, targetUserIds ARRAY, createdAt ASC, _id ASC`
- `social_likes`: deterministic `_id` point-read only
- `social_comments`: `shareId ASC, createdAt DESC, _id DESC`
- `hands`: deterministic source `handId` point-read followed by exact owner/player tuple comparison

`social_hand_shares`, `social_hand_share_slots`, `social_rate_limits`, and
`social_notification_outbox`, `social_likes`, and `social_comments` must all deny direct client reads and writes. Action,
friend witness, and outbox queries are exact indexed server queries outside
transactions; transaction stores support deterministic document point reads and
writes only.

## Task 4 notification collections

- `social_notifications`: `recipientId ASC, createdAt DESC, _id DESC`
- `social_notification_state`: point reads by deterministic `_id`; no additional index
- `social_notification_heads`: point reads by deterministic `_id`; no additional index
- `social_notification_actors`: point reads by deterministic `_id`; no additional index

The notification list query must use the first compound index with the exact sort directions above. Pagination is keyset-based on `(createdAt, _id)` and must not use `skip`.
