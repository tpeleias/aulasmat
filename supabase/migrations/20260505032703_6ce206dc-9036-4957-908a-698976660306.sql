
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Auto-make first signup admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN (SELECT count(*) FROM public.user_roles WHERE role='admin') = 0 THEN 'admin'::app_role ELSE 'user'::app_role END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Lessons
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name text NOT NULL,
  guardian_name text,
  subject text,
  start_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 60,
  price numeric(10,2) NOT NULL DEFAULT 220.00,
  package_type text NOT NULL DEFAULT 'single',
  payment_status text NOT NULL DEFAULT 'pendente',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage lessons" ON public.lessons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Public read of free time needs lessons start/end visible, but we'll only expose times via separate availability view logic in code.
-- For simplicity: public can read minimal lesson time fields via a SECURITY DEFINER function (no PII).

-- Blocks
CREATE TABLE public.blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  block_type text NOT NULL DEFAULT 'one_off', -- 'one_off' | 'recurring'
  start_at timestamptz,
  end_at timestamptz,
  weekday int, -- 0-6 for recurring (Sun=0)
  start_time time, -- for recurring
  end_time time,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage blocks" ON public.blocks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Settings (working hours)
CREATE TABLE public.settings (
  id int PRIMARY KEY DEFAULT 1,
  work_start time NOT NULL DEFAULT '08:00',
  work_end time NOT NULL DEFAULT '22:00',
  slot_minutes int NOT NULL DEFAULT 60,
  CHECK (id = 1)
);
INSERT INTO public.settings (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage settings" ON public.settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "anyone reads settings" ON public.settings FOR SELECT TO anon, authenticated USING (true);

-- Public availability function: returns busy time ranges (no PII) for given window
CREATE OR REPLACE FUNCTION public.get_busy_ranges(_from timestamptz, _to timestamptz)
RETURNS TABLE(start_at timestamptz, end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.start_at < _to AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.block_type = 'one_off' AND b.start_at < _to AND b.end_at > _from
$$;

CREATE OR REPLACE FUNCTION public.get_recurring_blocks()
RETURNS TABLE(weekday int, start_time time, end_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.weekday, b.start_time, b.end_time FROM public.blocks b WHERE b.block_type = 'recurring'
$$;

GRANT EXECUTE ON FUNCTION public.get_busy_ranges(timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recurring_blocks() TO anon, authenticated;
