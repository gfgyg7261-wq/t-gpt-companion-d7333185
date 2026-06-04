-- Admin license: grant admin role when claiming an 'admin' tier license
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

  -- Admin-tier licenses elevate the user to admin
  IF _lic.tier = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_uid, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  tier := _lic.tier; credits_per_day := _lic.credits_per_day;
  RETURN NEXT;
END; $function$;

-- Seed the special admin license key (idempotent)
INSERT INTO public.licenses (key, tier, credits_per_day, note, created_by)
SELECT 'JABIR-IS-THE-REAL-GOAT', 'admin', 999999, 'Master admin key', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.licenses WHERE key = 'JABIR-IS-THE-REAL-GOAT');