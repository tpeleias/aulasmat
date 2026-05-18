CREATE POLICY "children read own student-materials"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'student-materials'
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.child_user_id = auth.uid()
      AND s.id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "children read own homework-submissions"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'homework-submissions'
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.child_user_id = auth.uid()
      AND s.id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "children insert own homework-submissions"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'homework-submissions'
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.child_user_id = auth.uid()
      AND s.id::text = (storage.foldername(name))[1]
  )
);