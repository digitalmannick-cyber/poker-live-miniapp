# `poker_social` database indexes

All social collections are server-only. Configure CloudBase client permissions to deny direct client reads and writes. Every batch query below is fail-closed, keyset or convergence based, and must not fall back to `skip` or a full collection scan.

## Feed, friendship, and interaction queries

- `social_friendships`: `userA ASC, status ASC, acceptedAt DESC, _id ASC`
- `social_friendships`: `userB ASC, status ASC, acceptedAt DESC, _id ASC`
- `social_hand_shares`: `status ASC, scope ASC, createdAt DESC, _id DESC`
- `social_hand_shares`: `publisherId ASC, status ASC, createdAt DESC, _id DESC`
- `social_hand_shares`: `targetUserIds ARRAY, status ASC, createdAt DESC, _id DESC`
- `social_comments`: `shareId ASC, createdAt DESC, _id DESC`
- `social_notifications`: `recipientId ASC, createdAt DESC, _id DESC`
- `social_notification_outbox`: `status ASC, targetUserIds ARRAY, createdAt ASC, _id ASC`
- `social_invites`: `inviterId ASC, createdAt DESC, _id DESC`
- `social_player_card_shares`: `targetUserId ASC, status ASC, createdAt DESC, _id DESC`
- `social_comments`: `authorId ASC, createdAt DESC, _id DESC`
- `social_likes`: `actorId ASC, updatedAt DESC, _id DESC`

These four base product-query indexes remain alongside the narrower account-clear convergence indexes below; neither shape substitutes for the other.

## Authoritative source reads

- `hand_actions`: `ownerOpenId ASC, playerId ASC, handId ASC, sequence ASC, _id ASC`
- `hand_actions`: `_openid ASC, playerId ASC, handId ASC, sequence ASC, _id ASC`

The second action index is legacy `_openid` compatibility. Source hand, session, share slot, and notification state reads use deterministic document IDs followed by exact ownership checks.

## Account-clear convergence queries

- `social_users`: `ownerOpenId ASC, _id ASC`
- `social_invites`: `inviterId ASC, revokedAt ASC, createdAt ASC, _id ASC`
- `social_player_card_shares`: `senderUserId ASC, status ASC, createdAt DESC, _id DESC`
- `social_player_card_shares`: `targetUserId ASC, status ASC, importedAt ASC, createdAt DESC, _id DESC`
- `social_comments`: `authorId ASC, deleted ASC, createdAt DESC, _id DESC`
- `social_likes`: `actorId ASC, active ASC, updatedAt DESC, _id DESC`
- `social_notifications`: `actorSnapshot.socialUserId ASC, createdAt ASC, _id ASC`
- `social_notification_heads`: `recipientId ASC, latestAt ASC, _id ASC`
- `social_notification_actors`: `notificationId ASC, createdAt ASC, _id ASC`
- `social_notification_actors`: `actorId ASC, createdAt ASC, _id ASC`
- `social_notification_outbox`: `publisherId ASC, status ASC, createdAt ASC, _id ASC`
- `social_rate_limits`: `actorId ASC, _id ASC`
- `social_rate_limits`: `publisherId ASC, _id ASC`
- `social_mutations`: `actorId ASC, createdAt ASC, _id ASC`
- `social_daily_stats`: `socialUserId ASC, dateKey ASC, _id ASC`

## Private poker-data clear query

- `player_card_import_receipts`: `ownerOpenId ASC, playerId ASC, _id ASC`

The receipt clear query is owned by `poker_data.clear_all_data`; it uses the exact server-authoritative owner/player tuple before document removal.

For an account-clear target, the outbox records the user in `skippedTargetIds` and removes that user from `targetUserIds`. The existing single-array target query therefore supports both legacy and new outboxes, and every processed row stops matching without a cursor.

## Point-read-only collections

- `social_user_owners`: deterministic owner-hash `_id` reservation point-read only; permanently retained as an account-lifecycle tombstone and contains no raw OpenID
- `social_hand_share_slots`: deterministic `_id` point-read only
- `social_notification_state`: deterministic `_id` point-read only

## Deterministic point reads with additional account-clear indexes

- `social_rate_limits`: deterministic actor/action `_id`; account clear additionally uses the declared actor/publisher indexes
- `social_likes`: deterministic share/actor `_id`; account clear additionally uses the declared actor index
- `social_notification_heads`: deterministic recipient/kind/window `_id`; account clear additionally uses the declared recipient index
- `social_notification_actors`: deterministic notification/actor `_id`; account clear additionally uses the declared notification and actor indexes

Transaction stores expose deterministic document `get`, `set`, and `remove` only. All indexed list queries execute outside transactions, then transactions re-read and re-check each selected document before mutation.
