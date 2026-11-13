-- Execute once in your private Supabase project SQL editor.
create extension if not exists pgcrypto;
create table if not exists public.ds_subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code_hash text not null unique,
  status text not null default 'active' check(status in ('active','paused')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.ds_subscribers enable row level security;
-- No anonymous or authenticated policies: only the server-side service role can read/write.
create index if not exists ds_subscribers_expires_at_idx on public.ds_subscribers(expires_at);
