-- LICENSES
CREATE TABLE public.licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  credits_per_day integer NOT NULL DEFAULT 5,
  note text,
  created_by uuid,
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage licenses" ON public.licenses
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "view own claimed license" ON public.licenses
  FOR SELECT USING (auth.uid() = claimed_by);

-- BUILDER FILES
CREATE TABLE public.builder_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES public.builder_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  path text NOT NULL,
  content text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'txt',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_files TO authenticated;
GRANT ALL ON public.builder_files TO service_role;

ALTER TABLE public.builder_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins all builder files" ON public.builder_files
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "own builder files" ON public.builder_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PROFILE + CREDITS + THREAD COLUMNS
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS license_id uuid;
ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS daily_cap integer NOT NULL DEFAULT 5;
ALTER TABLE public.builder_threads ADD COLUMN IF NOT EXISTS entry_path text NOT NULL DEFAULT 'index.html';

-- UPDATED RESET FUNCTION (uses daily_cap)
CREATE OR REPLACE FUNCTION public.reset_credits_if_needed(_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bal int; _cap int;
BEGIN
  INSERT INTO public.credits (user_id, balance, daily_cap, last_reset)
  VALUES (_user_id, 5, 5, (now() AT TIME ZONE 'utc')::date)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT daily_cap INTO _cap FROM public.credits WHERE user_id = _user_id;
  _cap := COALESCE(_cap, 5);

  UPDATE public.credits
     SET balance = _cap, last_reset = (now() AT TIME ZONE 'utc')::date, updated_at = now()
   WHERE user_id = _user_id
     AND last_reset < (now() AT TIME ZONE 'utc')::date;

  SELECT balance INTO _bal FROM public.credits WHERE user_id = _user_id;
  RETURN COALESCE(_bal,0);
END; $function$;

-- ADMIN: create licenses
CREATE OR REPLACE FUNCTION public.admin_create_license(_tier text, _credits integer, _note text, _count integer)
 RETURNS TABLE(key text, tier text, credits_per_day integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _i int; _key text; _seg text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _count IS NULL OR _count < 1 OR _count > 100 THEN
    RAISE EXCEPTION 'Count must be between 1 and 100';
  END IF;
  FOR _i IN 1.._count LOOP
    _seg := upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    _key := 'TGPT-' || substr(_seg,1,4) || '-' || substr(_seg,5,4) || '-' || substr(_seg,9,4);
    INSERT INTO public.licenses (key, tier, credits_per_day, note, created_by)
    VALUES (_key, COALESCE(_tier,'free'), COALESCE(_credits,5), _note, auth.uid());
    key := _key; tier := COALESCE(_tier,'free'); credits_per_day := COALESCE(_credits,5);
    RETURN NEXT;
  END LOOP;
END; $function$;

-- ADMIN: list licenses
CREATE OR REPLACE FUNCTION public.admin_list_licenses()
 RETURNS TABLE(id uuid, key text, tier text, credits_per_day integer, note text, claimed_by uuid, claimed_email text, claimed_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT l.id, l.key, l.tier, l.credits_per_day, l.note, l.claimed_by,
    u.email::text, l.claimed_at, l.created_at
  FROM public.licenses l
  LEFT JOIN auth.users u ON u.id = l.claimed_by
  ORDER BY l.created_at DESC;
END; $function$;

-- USER: claim a license
CREATE OR REPLACE FUNCTION public.claim_license(_key text)
 RETURNS TABLE(tier text, credits_per_day integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _lic record; _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _lic FROM public.licenses WHERE key = upper(trim(_key));
  IF _lic.id IS NULL THEN RAISE EXCEPTION 'Invalid license key'; END IF;
  IF _lic.claimed_by IS NOT NULL AND _lic.claimed_by <> _uid THEN
    RAISE EXCEPTION 'This license is already in use';
  END IF;

  UPDATE public.licenses
     SET claimed_by = _uid, claimed_at = now()
   WHERE id = _lic.id;

  UPDATE public.profiles SET license_id = _lic.id WHERE id = _uid;

  INSERT INTO public.credits (user_id, balance, daily_cap, last_reset)
  VALUES (_uid, _lic.credits_per_day, _lic.credits_per_day, (now() AT TIME ZONE 'utc')::date)
  ON CONFLICT (user_id) DO UPDATE
    SET daily_cap = _lic.credits_per_day,
        balance = GREATEST(public.credits.balance, _lic.credits_per_day),
        updated_at = now();

  tier := _lic.tier; credits_per_day := _lic.credits_per_day;
  RETURN NEXT;
END; $function$;