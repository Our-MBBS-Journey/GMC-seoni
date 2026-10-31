# Our MBBS Journey — GMC Seoni · Batch 2026

A mobile-friendly private memories website for 15–20 friends. Built with HTML/CSS/JavaScript + Supabase Auth, Postgres, and Storage. No build step.

## Features included
- Email/password sign-up and login
- Member profile; access approval is OFF by default
- Admin approval/revocation for members
- Admin can selectively grant/revoke upload permission
- Upload multiple photos/videos (50 MB max each)
- Uploads are **pending** until an admin approves
- Admin can approve/reject submitted memories
- Gallery filters: Year 1–5, Hostel, College, Trips
- Search captions/categories/uploader
- Image/video viewer, responsive design
- Supabase Row Level Security (RLS) policies

## 1. Create Supabase project
1. Visit https://supabase.com and create a project.
2. Open **Project Settings → API**. Copy the **Project URL** and **anon/public key**.
3. In this folder open `config.js`, paste them in:
   ```js
   SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
   SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY"
   ```
   Do **not** use the `service_role` secret key in frontend code.

## 2. Create database & storage
1. In Supabase open **SQL Editor → New query**.
2. Copy/paste all of `supabase_setup.sql` and click **Run**.
3. In **Authentication → Providers → Email**, enable Email provider. For easiest testing you can temporarily turn off email confirmation; before sharing, configure email confirmation.
4. In **Authentication → URL Configuration**, add your deployed site URL to Site URL and Redirect URLs.

## 3. Deploy free on GitHub Pages
1. Create a GitHub repository named `our-mbbs-journey` (Public repository works with the anon key; database security is enforced by RLS).
2. Upload all project files at repository root: `index.html`, `style.css`, `app.js`, `config.js`, `supabase_setup.sql`, `README.md`.
3. Go to **Settings → Pages**. Choose **Deploy from a branch → main → /(root)** and Save.
4. Wait for Pages to deploy. Open the provided `https://YOUR-USERNAME.github.io/our-mbbs-journey/` link.
5. In Supabase URL Configuration add that exact URL to Redirect URLs.

## 4. Make yourself admin (important)
1. Sign up on the website using your intended admin email.
2. In Supabase → SQL Editor run (replace email):
   ```sql
   update public.profiles
   set is_admin=true, is_approved=true, can_upload=true
   where email='YOUR_ADMIN_EMAIL';
   ```
3. Sign out and sign back in. The **Community & approvals** admin panel will appear.

## 5. Invite your friends
- Share the website link with the 15–20 friends.
- They create accounts using their own email.
- Admin opens **Community & approvals → Members** and presses **Approve**.
- For trusted contributors only, choose **Allow upload**. Everyone else can view approved memories only.
- Their uploads show under **Pending uploads**; Admin presses **Approve** to publish or **Reject** to keep them out of the gallery.
- Remove access with **Remove**. This revokes approval and upload permission.

## Important privacy note
This version uses a **public Supabase Storage bucket** to render media easily. The site itself requires approved login to view the gallery, and uploads are restricted by RLS. But anyone who obtains a media's direct public URL may be able to open/download it. Do not upload highly sensitive/private images. For strict privacy, change bucket to private and implement signed URLs before using.

## Troubleshooting
- **“Setup required”**: `config.js` still has placeholder URL/key, or was not deployed.
- **Sign-up works but login not**: check Supabase Authentication → Email confirmation; confirm email or temporarily disable confirmations during testing.
- **New user doesn't show in Members**: ensure `handle_new_user` trigger exists; SQL script creates it.
- **Admin panel missing**: run the admin promotion SQL with the exact account email; then log out/in.
- **Upload error**: verify SQL ran, bucket `journey-media` exists, and profile has `is_approved=true, can_upload=true`.
- **Gallery empty**: only admin-approved submissions are displayed.
- **GitHub Pages 404**: check Settings → Pages and ensure `index.html` is at repository root.

## Files
- `index.html` — all page layout and forms
- `style.css` — responsive visual design
- `app.js` — auth, uploads, gallery, admin operations
- `config.js` — Supabase URL + anon/public key
- `supabase_setup.sql` — tables, trigger, RLS, storage bucket/policies

Made for our batch, with love. ✦
