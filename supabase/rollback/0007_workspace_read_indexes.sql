-- leadrescue:no-transaction
-- Manual performance-only rollback: use psql -f on a direct/session operator connection.
-- Do not wrap in BEGIN. App behavior is unchanged; recent-list performance returns to baseline.
-- Keep migration history intact; create a new forward migration to reintroduce indexes later.
DROP INDEX CONCURRENTLY IF EXISTS public.notifications_business_created_idx;

-- leadrescue:statement-break
DROP INDEX CONCURRENTLY IF EXISTS public.usage_events_business_created_idx;

-- leadrescue:statement-break
DROP INDEX CONCURRENTLY IF EXISTS public.messages_business_created_idx;

-- leadrescue:statement-break
DROP INDEX CONCURRENTLY IF EXISTS public.conversations_business_updated_idx;
