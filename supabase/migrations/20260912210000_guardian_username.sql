-- A guardian can now sign in with a username instead of an e-mail, the same way the
-- student already does. Auth still stores an address, built from the username on an
-- internal domain, so this column is what the app shows and what proves the account
-- was created that way.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_username text;

-- One username per person across both kinds of access: a guardian must not be able to
-- take over a student's login, and vice versa.
CREATE UNIQUE INDEX IF NOT EXISTS students_guardian_username_key
  ON public.students (lower(guardian_username)) WHERE guardian_username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_child_username_key
  ON public.students (lower(child_username)) WHERE child_username IS NOT NULL;
