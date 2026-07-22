-- =========================================================
-- Dive Trip Planner — Supabase schema (v2)
-- Run this in the Supabase SQL editor, top to bottom.
--
-- Design notes:
--   - Single-owner-editable for v1. trip_collaborators exists
--     unused, so read-only sharing can be added later without
--     restructuring anything.
--   - Every list table has a `position` column so drag-to-reorder
--     in the app can persist order.
--   - destination_candidates and trips both carry weather fields
--     (avg_water_temp_c, weather_fetched_at, etc.) so results from
--     Open-Meteo can be cached instead of re-fetched on every visit.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- Trips
-- ---------------------------------------------------------
create table trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'New Trip',
  destination_name text,
  lat numeric(9,6),
  lng numeric(9,6),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Sharing — unused in v1, ready for read-only sharing later
-- ---------------------------------------------------------
create table trip_collaborators (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  invited_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- ---------------------------------------------------------
-- Destination candidates — "which destination wins" comparison,
-- with cached weather/water-temp data attached per candidate
-- ---------------------------------------------------------
create table destination_candidates (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  lat numeric(9,6),
  lng numeric(9,6),
  target_date date,
  flight_cost numeric(10,2),
  package_cost numeric(10,2),
  diving_cost numeric(10,2),
  dive_rating numeric(4,3),
  experience_rating numeric(4,3),
  weather_rating numeric(4,3),
  notes text,
  -- cached conditions data (filled in by the app calling Open-Meteo)
  avg_water_temp_c numeric(4,1),
  avg_air_temp_c numeric(4,1),
  weather_summary text,
  weather_is_forecast boolean not null default false,
  weather_fetched_at timestamptz,
  position integer not null default 0
);

-- ---------------------------------------------------------
-- Dive shops
-- ---------------------------------------------------------
create table dive_shops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null default 'New Dive Shop',
  location text,
  status text not null default 'researching'
    check (status in ('researching', 'contacted', 'booked', 'confirmed')),
  website text,
  contact text,
  cost numeric(10,2),
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Dive sites — decoupled from dive_shops so sites can be
-- researched before an operator is chosen
-- ---------------------------------------------------------
create table dive_sites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  dive_shop_id uuid references dive_shops(id) on delete set null,
  name text not null default 'New Dive Site',
  target_date date,
  max_depth_m numeric(5,1),
  tank_type text check (tank_type in ('air', 'nitrox')),
  notes text,
  position integer not null default 0
);

-- ---------------------------------------------------------
-- Flights
-- ---------------------------------------------------------
create table flights (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  airline text,
  flight_number text,
  departure_at timestamptz,
  arrival_at timestamptz,
  confirmation_code text,
  notes text,
  position integer not null default 0
);

-- ---------------------------------------------------------
-- Accommodations
-- ---------------------------------------------------------
create table accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null default 'New Stay',
  check_in date,
  check_out date,
  has_fridge boolean not null default false,
  confirmation_code text,
  notes text,
  position integer not null default 0
);

-- ---------------------------------------------------------
-- Gear locker — personal, not trip-specific
-- ---------------------------------------------------------
create table gear_locker (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null default 'New Item',
  size text,
  notes text,
  position integer not null default 0
);

-- ---------------------------------------------------------
-- Certifications (C-cards) — personal, not trip-specific
-- ---------------------------------------------------------
create table certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agency text,
  level text,
  cert_number text,
  issued_date date,
  position integer not null default 0
);

-- =========================================================
-- Row Level Security
-- =========================================================
alter table trips enable row level security;
alter table trip_collaborators enable row level security;
alter table destination_candidates enable row level security;
alter table dive_shops enable row level security;
alter table dive_sites enable row level security;
alter table flights enable row level security;
alter table accommodations enable row level security;
alter table gear_locker enable row level security;
alter table certifications enable row level security;

create policy "trips_owner_all" on trips for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "trips_collaborator_view" on trips for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = trips.id and trip_collaborators.user_id = auth.uid()));

create policy "collaborators_owner_manage" on trip_collaborators for all
  using (exists (select 1 from trips where trips.id = trip_collaborators.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = trip_collaborators.trip_id and trips.owner_id = auth.uid()));

-- Reusable pattern for every trip-scoped table: full access if you
-- own the trip, read-only if you're a collaborator on it.
create policy "destination_candidates_owner_all" on destination_candidates for all
  using (exists (select 1 from trips where trips.id = destination_candidates.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = destination_candidates.trip_id and trips.owner_id = auth.uid()));
create policy "destination_candidates_collaborator_view" on destination_candidates for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = destination_candidates.trip_id and trip_collaborators.user_id = auth.uid()));

create policy "dive_shops_owner_all" on dive_shops for all
  using (exists (select 1 from trips where trips.id = dive_shops.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = dive_shops.trip_id and trips.owner_id = auth.uid()));
create policy "dive_shops_collaborator_view" on dive_shops for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = dive_shops.trip_id and trip_collaborators.user_id = auth.uid()));

create policy "dive_sites_owner_all" on dive_sites for all
  using (exists (select 1 from trips where trips.id = dive_sites.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = dive_sites.trip_id and trips.owner_id = auth.uid()));
create policy "dive_sites_collaborator_view" on dive_sites for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = dive_sites.trip_id and trip_collaborators.user_id = auth.uid()));

create policy "flights_owner_all" on flights for all
  using (exists (select 1 from trips where trips.id = flights.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = flights.trip_id and trips.owner_id = auth.uid()));
create policy "flights_collaborator_view" on flights for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = flights.trip_id and trip_collaborators.user_id = auth.uid()));

create policy "accommodations_owner_all" on accommodations for all
  using (exists (select 1 from trips where trips.id = accommodations.trip_id and trips.owner_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = accommodations.trip_id and trips.owner_id = auth.uid()));
create policy "accommodations_collaborator_view" on accommodations for select
  using (exists (select 1 from trip_collaborators where trip_collaborators.trip_id = accommodations.trip_id and trip_collaborators.user_id = auth.uid()));

-- Personal, non-trip-scoped tables: strictly own-data-only
create policy "gear_locker_own_data" on gear_locker for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "certifications_own_data" on certifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
