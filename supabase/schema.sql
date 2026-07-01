-- 특별실 예약 관리: Supabase(Postgres) 스키마
--
-- 사용 방법:
-- 1) Supabase 프로젝트 대시보드 → SQL Editor → New query
-- 2) 이 파일 내용 전체를 붙여넣고 Run
-- (한 번만 실행하면 됩니다. 이미 존재하는 테이블/정책은 건너뜁니다.)

-- ---------- rooms ----------
create table if not exists public.rooms (
    id text primary key,
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------- reservations ----------
create table if not exists public.reservations (
    id text primary key,
    room_id text not null references public.rooms(id) on delete cascade,
    date date not null,
    period text not null,
    name text,
    class text,
    purpose text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- 핵심: 같은 방/날짜/교시에 예약이 2개 이상 생기는 것을 DB 차원에서 원천 차단합니다.
    -- (기존 구글시트 버전은 이걸 클라이언트 로직으로만 방어하다 보니 드래그앤드롭 등에서 중복이 생겼습니다.)
    constraint reservations_room_date_period_unique unique (room_id, date, period)
);

create index if not exists reservations_room_date_idx on public.reservations (room_id, date);

-- ---------- hints (기본 배정 시간/워터마크) ----------
create table if not exists public.hints (
    id text primary key,
    kind text not null check (kind in ('room', 'cell')),
    room_id text not null,
    day_index int,
    slot_id text,
    text text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------- updated_at 자동 갱신 ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
    before update on public.rooms
    for each row execute function public.set_updated_at();

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at
    before update on public.reservations
    for each row execute function public.set_updated_at();

drop trigger if exists hints_set_updated_at on public.hints;
create trigger hints_set_updated_at
    before update on public.hints
    for each row execute function public.set_updated_at();

-- ---------- 고정 특별실 4개 시드 ----------
insert into public.rooms (id, name) values
    ('room-fixed-music', '음악실'),
    ('room-fixed-library', '도서실'),
    ('room-fixed-4f-meeting', '4층 회의실'),
    ('room-fixed-1f-av', '1층 시청각실')
on conflict (id) do nothing;

-- ---------- Row Level Security ----------
-- 이 앱은 로그인 없이 공유되는 구조입니다(기존 구글시트 버전과 동일한 보안 수준).
-- 즉 "누구나 publishable key로 읽고 쓸 수 있음" + 수정/삭제는 프론트에서 공통 비밀번호로 최소 방어.
-- 더 강한 보안이 필요해지면 이 정책을 좁히고 Supabase Auth를 붙이는 걸 권장합니다.
alter table public.rooms enable row level security;
alter table public.reservations enable row level security;
alter table public.hints enable row level security;

drop policy if exists "rooms_public_all" on public.rooms;
create policy "rooms_public_all" on public.rooms for all using (true) with check (true);

drop policy if exists "reservations_public_all" on public.reservations;
create policy "reservations_public_all" on public.reservations for all using (true) with check (true);

drop policy if exists "hints_public_all" on public.hints;
create policy "hints_public_all" on public.hints for all using (true) with check (true);

-- ---------- Realtime ----------
-- 변경 이벤트를 프론트로 즉시 밀어주기 위해 realtime publication에 추가합니다.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.reservations;
alter publication supabase_realtime add table public.hints;
