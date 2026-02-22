# Supabase Setup For Deal Intake Persistence

This project can persist merger/acquisition intake data using the `submit_deal_intake` MCP tool.

## 1. Create Project In Supabase

1. Go to `https://supabase.com/dashboard`.
2. Create a new project (or use an existing one).
3. Open `Project Settings` -> `API`.
4. Copy:
   - `Project URL` -> use as `SUPABASE_URL`
   - `service_role` key -> use as `SUPABASE_SERVICE_ROLE_KEY`

Use `service_role` only on the server side. Never expose it to client/browser code.

## 2. Create Tables (SQL Editor)

Open `SQL Editor` in Supabase and run:

```sql
create extension if not exists pgcrypto;

create table if not exists public.ma_deals (
  deal_id uuid primary key default gen_random_uuid(),
  workspace_id text not null unique,
  tenant_id text not null,
  deal_type text not null check (deal_type in ('merger', 'acquisition')),
  deal_name text not null,
  acquirer_name text not null,
  target_name text not null,
  thesis text not null,
  deal_value numeric(18,2),
  currency text not null default 'USD',
  expected_close_date date,
  jurisdiction text,
  industry text,
  owner_email text,
  materiality_threshold numeric(18,2) not null default 4500000,
  policy_profile text not null default 'strict-default',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ma_deal_documents (
  document_id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.ma_deals(deal_id) on delete cascade,
  workspace_id text not null,
  document_name text not null,
  document_type text not null,
  source_uri text,
  mime_type text,
  notes text,
  raw_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ma_deal_documents_deal_id
  on public.ma_deal_documents(deal_id);

create index if not exists idx_ma_deal_documents_workspace_id
  on public.ma_deal_documents(workspace_id);
```

## 3. Add Environment Variables

Create `ma-due-diligence-copilot/.env.local`:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_DEAL_TABLE=ma_deals
SUPABASE_DOCUMENT_TABLE=ma_deal_documents
SUPABASE_DOCUMENT_BUCKET=ma-diligence-docs
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

Optional table env vars default to `ma_deals` and `ma_deal_documents`.
`SUPABASE_DOCUMENT_BUCKET` defaults to `ma-diligence-docs`.
`OPENAI_API_KEY` is required only for the `analyze_documents_with_openai` tool.

## 4. Create Storage Bucket (for local file uploads)

In Supabase dashboard:
1. Open `Storage`.
2. Create bucket `ma-diligence-docs` (or your custom bucket name).
3. Keep it private for diligence data.

If you choose a different bucket name, set `SUPABASE_DOCUMENT_BUCKET` accordingly.

## 5. Run Server

```bash
cd ma-due-diligence-copilot
pnpm dev
```

Open `http://localhost:3000`, click:
- `Create New Merger` or `Create New Acquisition`
- Fill intake form and submit
- For each document, provide either:
  - source URI, or
  - local file upload (file is uploaded to Supabase Storage)

The widget calls `submit_deal_intake`, which:
1. creates a workspace in MCP server state,
2. inserts one row into `ma_deals`,
3. uploads local files to Supabase Storage (when provided),
4. inserts document rows into `ma_deal_documents`.

## 6. Verify In Supabase

In `Table Editor`:
- Check `public.ma_deals`
- Check `public.ma_deal_documents`

In `Storage`:
- Check bucket `ma-diligence-docs` for uploaded local documents.

You should see the newly inserted deal metadata, linked document rows, and uploaded file objects.
