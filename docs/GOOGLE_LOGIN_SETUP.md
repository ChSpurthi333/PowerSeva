# Setting up "Continue with Google"

The Google button works only after you create a free **Google Client ID** for your own site. This takes about 5 minutes. Without it, the button shows a message and normal Gmail + password login still works.

## Steps

1. Open <https://console.cloud.google.com/> and sign in with your Google account.
2. Create a project (top bar -> *New project*), for example `PowerSeva`.
3. Go to **APIs & Services -> OAuth consent screen**. Choose *External*, enter the app name `PowerSeva`, your email, and save. (Keep it in *Testing* mode while developing and add your own Gmail under *Test users*.)
4. Go to **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**.
   - Application type: **Web application**
   - **Authorized JavaScript origins:** add `http://localhost:5000` (and your real website address later, e.g. `https://powerseva.example.com`)
   - Leave *Authorized redirect URIs* empty.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
6. Open `backend/.env` and paste it:
   ```
   GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
   ```
7. Restart the server (`npm run dev` restarts by itself) and open <http://localhost:5000/login.html>. The **Continue with Google** button now opens Google's account chooser.

## How it behaves

- The browser gets a signed Google ID token; the backend verifies it with `google-auth-library` against your Client ID and the token's email must be verified.
- A first-time Google user gets a **citizen** account automatically (they can add phone and village in *My profile*).
- If a citizen with that Gmail already exists, the Google account is linked to it.
- Admin and technician accounts cannot be created through Google; the admin creates them in *Manage Users*. A Google sign-in for those emails is refused.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Button says Google sign-in is not set up | `GOOGLE_CLIENT_ID` is empty in `backend/.env`, or the server was not restarted |
| `Error 400: origin_mismatch` | Add the exact address shown in your browser (including `http://` and the port) to *Authorized JavaScript origins* |
| `Access blocked: app not verified` | Add your Gmail as a *Test user* on the OAuth consent screen |
| Button does not appear at all | Browser is offline or blocks `accounts.google.com` |
