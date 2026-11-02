/** Each candidate has a measured main-screen read; no speculative metrics indexes. */
export const proposedIndexes = [
  {
    name: 'conversations_business_updated_idx',
    table: 'conversations',
    sql: 'create index conversations_business_updated_idx on public.conversations(business_id,updated_at desc)',
    queries: ['conversations_recent'],
  },
  {
    name: 'messages_business_created_idx',
    table: 'messages',
    sql: 'create index messages_business_created_idx on public.messages(business_id,created_at desc)',
    queries: ['messages_recent'],
  },
  {
    name: 'usage_events_business_created_idx',
    table: 'usage_events',
    sql: 'create index usage_events_business_created_idx on public.usage_events(business_id,created_at desc)',
    queries: ['usage_recent'],
  },
  {
    name: 'notifications_business_created_idx',
    table: 'notifications',
    sql: 'create index notifications_business_created_idx on public.notifications(business_id,created_at desc)',
    queries: ['notifications_recent'],
  },
];
