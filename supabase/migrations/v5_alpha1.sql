-- Jay Invest V5 Alpha 1
-- Run this in Supabase SQL Editor once.

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text,
  event_type text not null default 'general_news',
  title text not null,
  summary text,
  analysis text,
  source_name text,
  source_url text,
  source_type text not null default 'unknown',
  score integer not null default 20 check (score between 0 and 100),
  confidence integer not null default 70 check (confidence between 0 and 100),
  strategy_impact boolean not null default false,
  is_read boolean not null default false,
  is_notified boolean not null default false,
  event_time timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists events_user_time_idx
  on public.events(user_id, event_time desc);

create index if not exists events_user_symbol_idx
  on public.events(user_id, symbol);

alter table public.events enable row level security;

drop policy if exists "Users can view own events" on public.events;
create policy "Users can view own events"
on public.events for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own events" on public.events;
create policy "Users can insert own events"
on public.events for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own events" on public.events;
create policy "Users can update own events"
on public.events for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own events" on public.events;
create policy "Users can delete own events"
on public.events for delete to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text,
  report_date date not null default current_date,
  summary text,
  decision text,
  evidence jsonb not null default '[]'::jsonb,
  fundamental_score integer check (fundamental_score between 0 and 100),
  technical_score integer check (technical_score between 0 and 100),
  news_score integer check (news_score between 0 and 100),
  macro_score integer check (macro_score between 0 and 100),
  overall_score integer check (overall_score between 0 and 100),
  confidence integer check (confidence between 0 and 100),
  created_at timestamptz not null default now(),
  unique(user_id, symbol, report_date)
);

alter table public.ai_reports enable row level security;

drop policy if exists "Users can view own reports" on public.ai_reports;
create policy "Users can view own reports"
on public.ai_reports for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own reports" on public.ai_reports;
create policy "Users can insert own reports"
on public.ai_reports for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own reports" on public.ai_reports;
create policy "Users can update own reports"
on public.ai_reports for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own reports" on public.ai_reports;
create policy "Users can delete own reports"
on public.ai_reports for delete to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  channel text not null default 'in_app',
  title text not null,
  body text not null,
  status text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notification_queue enable row level security;

drop policy if exists "Users can view own notifications" on public.notification_queue;
create policy "Users can view own notifications"
on public.notification_queue for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own notifications" on public.notification_queue;
create policy "Users can insert own notifications"
on public.notification_queue for insert to authenticated
with check ((select auth.uid()) = user_id);
