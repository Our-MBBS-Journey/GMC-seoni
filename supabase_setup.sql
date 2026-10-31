-- OUR MBBS JOURNEY — Supabase setup (run in SQL Editor)
-- A) Create a private project at https://supabase.com
-- B) Storage bucket "journey-media" is created below as PUBLIC for easy image/video display.
--    RLS prevents uploads/deletes by non-authorized users. Public URLs are unlisted-but-shareable;
--    use private bucket + signed URLs if you require stronger media privacy.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_approved boolean not null default false,
  can_upload boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  caption text not null,
  category text not null check(category in ('Year 1','Year 2','Year 3','Year 4','Year 5','Hostel','College','Trips')),
  memory_date date,
  storage_path text not null,
  public_url text not null,
  media_type text not null check(media_type in ('image','video')),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  uploader_name text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.memories enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from profiles where id=auth.uid() and is_admin=true and is_approved=true); $$;
create or replace function public.is_approved_member()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from profiles where id=auth.uid() and is_approved=true); $$;
create or replace function public.can_upload_memories()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from profiles where id=auth.uid() and is_approved=true and can_upload=true); $$;

-- Profile row automatically created at sign-up; approval/upload remain OFF by default.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into public.profiles(id,email,full_name)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''));
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

drop policy if exists "Members can view approved profiles" on profiles;
create policy "Members can view approved profiles" on profiles for select to authenticated
using (id=auth.uid() or public.is_admin() or (is_approved=true and public.is_approved_member()));
drop policy if exists "Members can update own name" on profiles;
create policy "Members can update own name" on profiles for update to authenticated
using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "Admin manage profiles" on profiles;
create policy "Admin manage profiles" on profiles for all to authenticated
using(public.is_admin()) with check(public.is_admin());

drop policy if exists "Approved members view published memories" on memories;
create policy "Approved members view published memories" on memories for select to authenticated
using(status='approved' and public.is_approved_member());
drop policy if exists "Uploader sees own submissions" on memories;
create policy "Uploader sees own submissions" on memories for select to authenticated
using(uploader_id=auth.uid());
drop policy if exists "Admins view all memories" on memories;
create policy "Admins view all memories" on memories for select to authenticated
using(public.is_admin());
drop policy if exists "Authorized friends submit" on memories;
create policy "Authorized friends submit" on memories for insert to authenticated
with check(public.can_upload_memories() and uploader_id=auth.uid() and status='pending');
drop policy if exists "Admins review memories" on memories;
create policy "Admins review memories" on memories for update to authenticated
using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Admins delete memories" on memories;
create policy "Admins delete memories" on memories for delete to authenticated
using(public.is_admin());

-- Storage bucket: 50 MB per object; allow common image/video MIME types.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('journey-media','journey-media',true,52428800,
array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set public=true,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Authorized members upload to own folder" on storage.objects;
create policy "Authorized members upload to own folder" on storage.objects for insert to authenticated
with check(bucket_id='journey-media' and (storage.foldername(name))[1]=auth.uid()::text and public.can_upload_memories());
drop policy if exists "Approved members read journey media" on storage.objects;
create policy "Approved members read journey media" on storage.objects for select to authenticated
using(bucket_id='journey-media' and public.is_approved_member());
drop policy if exists "Admins delete journey media" on storage.objects;
create policy "Admins delete journey media" on storage.objects for delete to authenticated
using(bucket_id='journey-media' and public.is_admin());

-- AFTER creating your account, run this with your own account email:
-- update public.profiles set is_admin=true,is_approved=true,can_upload=true
-- where email='YOUR_ADMIN_EMAIL';
-- Then approve friends and selectively enable can_upload in Admin > Members.
