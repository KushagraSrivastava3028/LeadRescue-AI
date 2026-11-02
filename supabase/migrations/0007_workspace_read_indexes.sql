-- leadrescue:no-transaction
-- Measured main-screen ordering gaps, not a speculative index list.
-- Run each marked statement separately on a direct/session operator connection.
-- Concurrent builds preserve writes but still consume CPU/I/O and acquire brief locks.
-- Interrupted/invalid builds require operator review before this migration is marked applied.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_business_updated_idx
  ON public.conversations (business_id, updated_at DESC);

-- leadrescue:statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_business_created_idx
  ON public.messages (business_id, created_at DESC);

-- leadrescue:statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS usage_events_business_created_idx
  ON public.usage_events (business_id, created_at DESC);

-- leadrescue:statement-break
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_business_created_idx
  ON public.notifications (business_id, created_at DESC);
