-- Турнир по бильярду: сетка double elimination на 8 игроков + пикем.
-- Вся работа с данными идёт через SECURITY DEFINER функции (RPC).
-- Таблицы закрыты RLS без политик: напрямую из браузера их не прочитать.

create extension if not exists pgcrypto with schema extensions;

-- ───────────── Таблицы ─────────────

create table if not exists public.players (
  id   int primary key,            -- посев (№1..№10)
  name text not null unique
);

create table if not exists public.match_defs (
  id        int primary key check (id between 1 and 31),
  bracket   text not null check (bracket in ('upper', 'lower', 'final')),
  round     text not null,          -- подпись раунда
  a_src     text not null,          -- S8 = посев №8, W1 = победитель М1, L6 = проигравший М6
  b_src     text not null,
  loser_to  text,                   -- подпись «пр. → М10» / «4 место»
  points    int  not null,          -- очки пикема за угаданного победителя
  play_order int not null,          -- шаг из «Порядка игр»
  reset_of  int,                    -- решающий матч: играется, только если матч reset_of выиграл игрок нижней сетки
  loser_place int,                  -- какое место занимает проигравший (3, 4, 5, 7)
  top4      boolean not null default false  -- оба участника гарантированно в топ-4
);

create table if not exists public.matches (
  id          int primary key references public.match_defs(id),
  winner      int references public.players(id),
  score       text,
  locked      boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table if not exists public.accounts (
  id              serial primary key,
  name            text not null unique,
  player_id       int references public.players(id),
  pass_hash       text not null,
  is_admin        boolean not null default false,
  failed_attempts int not null default 0,
  blocked_until   timestamptz
);

create table if not exists public.sessions (
  token      uuid primary key default gen_random_uuid(),
  account_id int not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.picks (
  account_id int not null references public.accounts(id) on delete cascade,
  match_id   int not null references public.match_defs(id),
  player_id  int not null references public.players(id),
  updated_at timestamptz not null default now(),
  primary key (account_id, match_id)
);

create table if not exists public.predictions (
  account_id int  not null references public.accounts(id) on delete cascade,
  kind       text not null check (kind in ('champion', 'top4', 'zero')),
  slot       int  not null,
  player_id  int  not null references public.players(id),
  primary key (account_id, kind, slot)
);

create table if not exists public.settings (
  key   text primary key,
  value text not null default ''
);

alter table public.players     enable row level security;
alter table public.match_defs  enable row level security;
alter table public.matches     enable row level security;
alter table public.accounts    enable row level security;
alter table public.sessions    enable row level security;
alter table public.picks       enable row level security;
alter table public.predictions enable row level security;
alter table public.settings    enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ───────────── Данные турнира (из PDF) ─────────────

insert into public.players (id, name) values
  (1, 'Кутя'), (2, 'Шер'), (3, 'Иса'), (4, 'Ильяс'),
  (5, 'Керим'), (6, 'Атай'), (7, 'Арлен'), (8, 'Бекжа')
on conflict (id) do update set name = excluded.name;

-- Сетка на 8 игроков: 1/4 финала по посеву 1–8, 4–5, 2–7, 3–6.
-- В нижней сетке пары перекрёстные, чтобы не было повторных встреч.
insert into public.match_defs (id, bracket, round, a_src, b_src, loser_to, points, play_order, reset_of, loser_place, top4) values
  ( 1, 'upper', '1/4 финала',     'S1',  'S8',  'пр. → М5',      1, 1, null, null, false),
  ( 2, 'upper', '1/4 финала',     'S4',  'S5',  'пр. → М5',      1, 1, null, null, false),
  ( 3, 'upper', '1/4 финала',     'S2',  'S7',  'пр. → М6',      1, 1, null, null, false),
  ( 4, 'upper', '1/4 финала',     'S3',  'S6',  'пр. → М6',      1, 1, null, null, false),
  ( 5, 'lower', '1-й раунд',      'L1',  'L2',  'пр. выбывает',  1, 2, null, 7,    false),
  ( 6, 'lower', '1-й раунд',      'L3',  'L4',  'пр. выбывает',  1, 2, null, 7,    false),
  ( 7, 'upper', '1/2 финала',     'W1',  'W2',  'пр. → М10',     2, 3, null, null, false),
  ( 8, 'upper', '1/2 финала',     'W3',  'W4',  'пр. → М9',      2, 3, null, null, false),
  ( 9, 'lower', '2-й раунд',      'W5',  'L8',  'пр. выбывает',  2, 4, null, 5,    false),
  (10, 'lower', '2-й раунд',      'W6',  'L7',  'пр. выбывает',  2, 4, null, 5,    false),
  (11, 'upper', 'Финал верхней',  'W7',  'W8',  'пр. → М13',     3, 5, null, null, true),
  (12, 'lower', '3-й раунд',      'W9',  'W10', 'пр. — 4 место', 2, 6, null, 4,    true),
  (13, 'lower', 'Финал нижней',   'W12', 'L11', 'пр. — 3 место', 3, 7, null, 3,    false),
  (14, 'final', 'Суперфинал',     'W11', 'W13', null,            5, 8, null, null, false),
  (15, 'final', 'Решающий матч',  'W11', 'W13', null,            5, 8, 14,   null, false)
on conflict (id) do update set
  bracket = excluded.bracket, round = excluded.round, a_src = excluded.a_src,
  b_src = excluded.b_src, loser_to = excluded.loser_to, points = excluded.points,
  play_order = excluded.play_order, reset_of = excluded.reset_of,
  loser_place = excluded.loser_place, top4 = excluded.top4;

insert into public.matches (id) select id from public.match_defs on conflict do nothing;

insert into public.settings (key, value) values
  ('title', 'Турнир по бильярду'), ('date', ''), ('place', ''), ('predictions_locked', 'false')
on conflict (key) do nothing;

-- ───────────── Логика сетки ─────────────

-- Пересчитывает участников всех матчей по посеву и сохранённым победителям.
-- Сохранённый победитель учитывается, только если он реально один из двух участников.
create or replace function public.compute_bracket()
returns table (match_id int, a int, b int, winner int, loser int, active boolean)
language plpgsql stable
set search_path = public
as $$
declare
  w   int[] := array_fill(null::int, array[31]);
  l   int[] := array_fill(null::int, array[31]);
  d   record;
  pa  int;
  pb  int;
  win int;
  act boolean;
begin
  for d in
    select md.id, md.a_src, md.b_src, md.reset_of, m.winner as stored
    from match_defs md join matches m on m.id = md.id
    order by md.id
  loop
    pa := case left(d.a_src, 1)
            when 'S' then substr(d.a_src, 2)::int
            when 'W' then w[substr(d.a_src, 2)::int]
            else          l[substr(d.a_src, 2)::int] end;
    pb := case left(d.b_src, 1)
            when 'S' then substr(d.b_src, 2)::int
            when 'W' then w[substr(d.b_src, 2)::int]
            else          l[substr(d.b_src, 2)::int] end;

    -- Решающий матч играется, только если суперфинал выиграл игрок из нижней сетки (сторона b).
    act := d.reset_of is null or (w[d.reset_of] is not null and w[d.reset_of] = pb);

    if act and pa is not null and pb is not null and d.stored in (pa, pb) then
      win := d.stored;
    else
      win := null;
    end if;

    w[d.id] := win;
    l[d.id] := case when win is null then null when win = pa then pb else pa end;

    match_id := d.id; a := pa; b := pb; winner := win; loser := l[d.id]; active := act;
    return next;
  end loop;
end;
$$;

-- ───────────── Вспомогательные функции ─────────────

create or replace function public._session_account(p_token uuid)
returns public.accounts
language plpgsql stable security definer
set search_path = public
as $$
declare acc accounts;
begin
  select a.* into acc
  from sessions s join accounts a on a.id = s.account_id
  where s.token = p_token and s.created_at > now() - interval '90 days';
  if acc.id is null then
    raise exception 'Сессия истекла, войдите заново' using errcode = 'P0001', hint = 'auth';
  end if;
  return acc;
end;
$$;

create or replace function public._require_admin(p_token uuid)
returns public.accounts
language plpgsql stable security definer
set search_path = public
as $$
declare acc accounts;
begin
  acc := _session_account(p_token);
  if not acc.is_admin then
    raise exception 'Только для организатора';
  end if;
  return acc;
end;
$$;

create or replace function public._predictions_open()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from settings where key = 'predictions_locked'), 'false') <> 'true'
     and not exists (select 1 from matches where locked or winner is not null);
$$;

-- Итоговые места: 1–2 по суперфиналу (и решающему матчу), 3–4 по проигравшим в нижней сетке.
create or replace function public._placements()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  gf record; rs record;
  champ int; second int;
begin
  select c.* into gf from compute_bracket() c join match_defs md on md.id = c.match_id
   where md.bracket = 'final' and md.reset_of is null;
  select c.* into rs from compute_bracket() c join match_defs md on md.id = c.match_id
   where md.reset_of is not null;
  if gf.winner is not null then
    if gf.winner = gf.a then champ := gf.a; second := gf.b;
    elsif rs.winner is not null then champ := rs.winner; second := rs.loser;
    end if;
  end if;
  return jsonb_build_object(
    '1', champ, '2', second,
    '3', (select c.loser from compute_bracket() c join match_defs md on md.id = c.match_id where md.loser_place = 3),
    '4', (select c.loser from compute_bracket() c join match_defs md on md.id = c.match_id where md.loser_place = 4));
end;
$$;

-- Матч скрывает чужие пики, пока открыт приём (нет результата и не закрыт организатором).
create or replace function public._match_revealed(p_locked boolean, p_winner int)
returns boolean language sql immutable as $$ select p_locked or p_winner is not null $$;

-- ───────────── Публичные RPC ─────────────

create or replace function public.login(p_name text, p_password text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  acc accounts;
  tok uuid;
begin
  select * into acc from accounts where name = p_name;
  if acc.id is null then
    raise exception 'Неверное имя или пароль';
  end if;
  if acc.blocked_until is not null and acc.blocked_until > now() then
    raise exception 'Слишком много попыток. Подождите пару минут';
  end if;
  if acc.pass_hash <> crypt(coalesce(p_password, ''), acc.pass_hash) then
    update accounts
       set failed_attempts = failed_attempts + 1,
           blocked_until = case when failed_attempts + 1 >= 8 then now() + interval '2 minutes' end
     where id = acc.id;
    -- Счётчик неудачных попыток должен сохраниться, поэтому ошибку не бросаем,
    -- а возвращаем её как результат.
    return jsonb_build_object('error', 'Неверное имя или пароль');
  end if;

  update accounts set failed_attempts = 0, blocked_until = null where id = acc.id;
  delete from sessions where created_at < now() - interval '90 days';
  insert into sessions (account_id) values (acc.id) returning token into tok;
  return jsonb_build_object('token', tok, 'name', acc.name, 'is_admin', acc.is_admin);
end;
$$;

create or replace function public.logout(p_token uuid)
returns void
language sql volatile security definer
set search_path = public
as $$ delete from sessions where token = p_token $$;

create or replace function public.change_password(p_token uuid, p_old text, p_new text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare acc accounts;
begin
  acc := _session_account(p_token);
  if acc.pass_hash <> crypt(coalesce(p_old, ''), acc.pass_hash) then
    raise exception 'Старый пароль неверный';
  end if;
  if length(coalesce(p_new, '')) < 6 then
    raise exception 'Новый пароль должен быть не короче 6 символов';
  end if;
  update accounts set pass_hash = crypt(p_new, gen_salt('bf')) where id = acc.id;
  delete from sessions where account_id = acc.id and token <> p_token;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_state(p_token uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  acc      accounts;
  br       jsonb;
  res      jsonb;
  pred_open boolean := _predictions_open();
begin
  if p_token is not null then
    select a.* into acc from sessions s join accounts a on a.id = s.account_id
     where s.token = p_token and s.created_at > now() - interval '90 days';
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', md.id, 'bracket', md.bracket, 'round', md.round,
           'a_src', md.a_src, 'b_src', md.b_src, 'loser_to', md.loser_to,
           'points', md.points, 'play_order', md.play_order, 'reset_of', md.reset_of,
           'a', br.a, 'b', br.b, 'winner', br.winner, 'loser', br.loser,
           'active', br.active, 'score', m.score, 'locked', m.locked,
           'open', br.active and br.a is not null and br.b is not null
                   and br.winner is null and not m.locked,
           'revealed', not pred_open,
           'votes', case when not pred_open then (
               select coalesce(jsonb_object_agg(v.player_id, v.cnt), '{}'::jsonb)
               from (select p.player_id, count(*) cnt from picks p
                      join accounts ac on ac.id = p.account_id and not ac.is_admin
                     where p.match_id = md.id and p.player_id in (br.a, br.b)
                     group by p.player_id) v)
             end
         ) order by md.id)
    into br
    from match_defs md join matches m on m.id = md.id join compute_bracket() br on br.match_id = md.id;

  res := jsonb_build_object(
    'settings', (select jsonb_object_agg(key, value) from settings),
    'players',  (select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by id) from players),
    'accounts', (select jsonb_agg(jsonb_build_object('name', name, 'is_admin', is_admin, 'player_id', player_id)
                                  order by is_admin, player_id) from accounts),
    'matches',  br,
    'predictions_open', pred_open,
    'placements', _placements(),
    'leaderboard', (select coalesce(jsonb_agg(to_jsonb(lb) order by lb.total desc, lb.correct desc, lb.name), '[]'::jsonb)
                      from public._leaderboard() lb),
    'revealed_picks', (
      -- Сетки участников видны всем, как только пикем закрыт (начался турнир)
      select coalesce(jsonb_agg(jsonb_build_object('account', ac.name, 'match_id', p.match_id, 'player_id', p.player_id)), '[]'::jsonb)
        from picks p join accounts ac on ac.id = p.account_id
       where not ac.is_admin and not pred_open),
    'revealed_predictions', case when pred_open then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('account', ac.name, 'kind', pr.kind, 'slot', pr.slot, 'player_id', pr.player_id)), '[]'::jsonb)
        from predictions pr join accounts ac on ac.id = pr.account_id where not ac.is_admin) end,
    'server_time', now()
  );

  if acc.id is not null then
    res := res || jsonb_build_object(
      'me', jsonb_build_object('name', acc.name, 'is_admin', acc.is_admin, 'player_id', acc.player_id),
      'my_picks', (select coalesce(jsonb_object_agg(match_id, player_id), '{}'::jsonb) from picks where account_id = acc.id),
      'my_predictions', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'slot', slot, 'player_id', player_id)), '[]'::jsonb)
                           from predictions where account_id = acc.id)
    );
  end if;
  return res;
end;
$$;

-- Таблица пикема (внутренняя, вызывается из get_state). Очки — только за угаданных победителей матчей.
-- Колонка pred_pts оставлена для совместимости и всегда равна 0.
create or replace function public._leaderboard()
returns table (name text, match_pts int, pred_pts int, total int, correct int, decided int, picked int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  return query
  with mp as (
    select p.account_id,
           sum(case when p.player_id = br.winner then md.points else 0 end)::int as pts,
           count(*) filter (where p.player_id = br.winner)::int as ok,
           count(*) filter (where br.winner is not null)::int as dec,
           count(*)::int as cnt
    from picks p
    join compute_bracket() br on br.match_id = p.match_id and br.active
    join match_defs md on md.id = p.match_id
    group by p.account_id
  )
  select ac.name,
         coalesce(mp.pts, 0), 0,
         coalesce(mp.pts, 0),
         coalesce(mp.ok, 0),
         coalesce(mp.dec, 0), coalesce(mp.cnt, 0)
  from accounts ac
  left join mp on mp.account_id = ac.id
  where not ac.is_admin;
end;
$$;

-- Пикем как на мейджоре: вся сетка заполняется целиком до начала турнира.
-- p_picks = {"<номер матча>": <id игрока-победителя>, ...}. Прогнозы должны быть согласованы:
-- в каждом матче выбран один из двух игроков, которые попадают туда по прогнозам предыдущих матчей.
create or replace function public.save_bracket(p_token uuid, p_picks jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  acc accounts;
  w   int[] := array_fill(null::int, array[31]);
  l   int[] := array_fill(null::int, array[31]);
  d   record;
  pa  int;
  pb  int;
  pk  int;
  act boolean;
begin
  acc := _session_account(p_token);
  if acc.is_admin then raise exception 'Организатор не участвует в пикеме'; end if;
  if not _predictions_open() then raise exception 'Пикем закрыт: турнир уже начался'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then raise exception 'Неверный формат пикема'; end if;

  delete from picks where account_id = acc.id;
  for d in select md.id, md.a_src, md.b_src, md.reset_of from match_defs md order by md.id loop
    pa := case left(d.a_src, 1) when 'S' then substr(d.a_src, 2)::int
            when 'W' then w[substr(d.a_src, 2)::int] else l[substr(d.a_src, 2)::int] end;
    pb := case left(d.b_src, 1) when 'S' then substr(d.b_src, 2)::int
            when 'W' then w[substr(d.b_src, 2)::int] else l[substr(d.b_src, 2)::int] end;
    act := d.reset_of is null or (w[d.reset_of] is not null and w[d.reset_of] = pb);
    pk := nullif(p_picks ->> d.id::text, '')::int;
    if pk is not null then
      if not act or pa is null or pb is null or pk not in (pa, pb) then
        raise exception 'Прогноз на М% не совпадает с вашей сеткой — обновите страницу', d.id;
      end if;
      insert into picks (account_id, match_id, player_id) values (acc.id, d.id, pk);
    end if;
    w[d.id] := pk;
    l[d.id] := case when pk is null then null when pk = pa then pb else pa end;
  end loop;
  return get_state(p_token);
end;
$$;

-- ───────────── RPC организатора ─────────────

create or replace function public.admin_set_result(p_token uuid, p_match int, p_winner int, p_score text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  br record;
  changed boolean := true;
begin
  perform _require_admin(p_token);
  select * into br from compute_bracket() where match_id = p_match;
  if br.match_id is null then raise exception 'Нет такого матча'; end if;
  if p_winner is not null then
    if not br.active then raise exception 'Решающий матч не нужен: суперфинал выиграл игрок верхней сетки'; end if;
    if br.a is null or br.b is null then raise exception 'Участники матча ещё не определены'; end if;
    if p_winner not in (br.a, br.b) then raise exception 'Этот игрок не играет в матче'; end if;
  end if;

  update matches
     set winner = p_winner,
         score = nullif(trim(coalesce(p_score, '')), ''),
         locked = case when p_winner is not null then true else locked end,
         updated_at = now()
   where id = p_match;

  -- Стираем результаты, которые стали невозможны после исправления.
  while changed loop
    update matches m set winner = null, updated_at = now()
      from compute_bracket() c
     where c.match_id = m.id and m.winner is not null and c.winner is null;
    changed := found;
  end loop;

  return get_state(p_token);
end;
$$;

create or replace function public.admin_set_lock(p_token uuid, p_match int, p_locked boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform _require_admin(p_token);
  update matches set locked = coalesce(p_locked, false), updated_at = now() where id = p_match;
  return get_state(p_token);
end;
$$;

create or replace function public.admin_set_setting(p_token uuid, p_key text, p_value text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform _require_admin(p_token);
  if p_key not in ('title', 'date', 'place', 'predictions_locked') then
    raise exception 'Неизвестная настройка';
  end if;
  insert into settings (key, value) values (p_key, coalesce(p_value, ''))
  on conflict (key) do update set value = excluded.value;
  return get_state(p_token);
end;
$$;

create or replace function public.admin_reset_password(p_token uuid, p_name text, p_new text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
begin
  perform _require_admin(p_token);
  if length(coalesce(p_new, '')) < 6 then
    raise exception 'Пароль должен быть не короче 6 символов';
  end if;
  update accounts set pass_hash = crypt(p_new, gen_salt('bf')), failed_attempts = 0, blocked_until = null
   where name = p_name;
  if not found then raise exception 'Нет такого участника'; end if;
  delete from sessions s using accounts a where s.account_id = a.id and a.name = p_name;
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────── Права ─────────────

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.login(text, text),
  public.logout(uuid),
  public.change_password(uuid, text, text),
  public.get_state(uuid),
  public.save_bracket(uuid, jsonb),
  public.admin_set_result(uuid, int, int, text),
  public.admin_set_lock(uuid, int, boolean),
  public.admin_set_setting(uuid, text, text),
  public.admin_reset_password(uuid, text, text)
to anon, authenticated;
