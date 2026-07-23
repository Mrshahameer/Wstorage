# Test scripts

## test-b2.mjs — Backblaze connectivity + pipeline test

Confirms your B2 key, bucket, and region work by running the *exact* flow the app uses
(presign PUT → upload → HeadObject confirm → presign GET). Independent of Supabase.

### Run
```bash
npm install                 # once, to get the AWS SDK
# fill B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_NAME / B2_REGION in .env.local
npm run test:b2                         # uploads test-assets/hello.txt, then deletes it
npm run test:b2 -- test-assets/wstorage-test.png   # upload the PNG instead
npm run test:b2:keep                    # leave the object in the bucket for your console screenshot
```

Included copyright-free test assets (both generated, CC0, safe to delete):
- `test-assets/hello.txt`
- `test-assets/wstorage-test.png`

Want a **video**? Grab any CC0 clip from pexels.com/videos or pixabay.com (both CC0),
drop it in `test-assets/`, then:
```bash
npm run test:b2:keep -- test-assets/your-clip.mp4
```

## Testing the full app endpoints
Once Supabase is wired and the app is running (`npm run dev`), the **Upload** button on the
Files page already exercises `/api/upload/presign` → direct PUT → `/api/upload/complete`.
Log in as admin, hit Upload, and watch the object appear in your B2 console.
