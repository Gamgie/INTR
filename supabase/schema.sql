-- InterMittens: schéma Supabase.
-- À coller une fois dans Supabase > SQL Editor > New query > Run.
-- Tout l'accès passe par le serveur (clé secrète). Les règles d'accès par ligne sont activées
-- sans aucune règle : la clé publique ne peut rien lire ni écrire.

create table if not exists public.intermittens_data (
	id text primary key,
	data jsonb not null,
	updated_at timestamptz not null default now()
);

alter table public.intermittens_data enable row level security;

-- Historique automatique : chaque écriture garde la version précédente (filet de sécurité).
create table if not exists public.intermittens_data_history (
	history_id bigint generated always as identity primary key,
	id text not null,
	data jsonb not null,
	saved_at timestamptz not null default now()
);

alter table public.intermittens_data_history enable row level security;

create or replace function public.intermittens_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.intermittens_data_history (id, data) values (old.id, old.data);
	delete from public.intermittens_data_history
	where history_id in (
		select history_id from public.intermittens_data_history
		where id = old.id
		order by history_id desc
		offset 200
	);
	return new;
end;
$$;

drop trigger if exists intermittens_history on public.intermittens_data;
create trigger intermittens_history
	before update on public.intermittens_data
	for each row execute function public.intermittens_keep_history();

-- Bucket privé pour les PDF (bulletins, contrats, AEM, notifications ARE...).
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;
