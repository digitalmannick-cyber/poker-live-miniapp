# `poker_social` database indexes

All social collections are server-only. Configure CloudBase client permissions to deny direct client reads and writes.

## Task 4 notification collections

- `social_notifications`: `recipientId ASC, createdAt DESC, _id DESC`
- `social_notification_state`: point reads by deterministic `_id`; no additional index
- `social_notification_heads`: point reads by deterministic `_id`; no additional index
- `social_notification_actors`: point reads by deterministic `_id`; no additional index

The notification list query must use the first compound index with the exact sort directions above. Pagination is keyset-based on `(createdAt, _id)` and must not use `skip`.
