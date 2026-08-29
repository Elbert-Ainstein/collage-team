# Why the reset email doesn't arrive, and how to fix it

Somebody presses **Forgot your password?**, the screen says a link is on its way,
and nothing ever lands. This is the runbook for that.

The app's side is already right: `resetPasswordForEmail` is called, real send
failures are surfaced, and the link that comes back now reaches the "Set a new
password" screen from either `/` or `/ck`. What is left is Supabase's side, and
none of it is code — it is four settings in the dashboard.

Work through them in this order. The first one is almost always the answer.

---

## 1. You are still on Supabase's built-in email sender

**Project Settings → Authentication → SMTP Settings.** If "Enable Custom SMTP"
is off, every auth email — confirmations, reset links, magic links — goes
through Supabase's built-in sender, and that sender is explicitly a development
convenience rather than a mail service:

- it is rate-limited to a **handful of messages an hour** across the whole
  project, and
- delivery is restricted to **addresses that belong to members of your Supabase
  organisation**.

That second one is the killer here. A reset requested for
`someone@college.harvard.edu` is not a team member's address, so the message is
simply not delivered — and the API still answers cleanly, because as far as
GoTrue is concerned it handed the mail off. There is no error for the app to
show, which is exactly why this looks like a bug in the app.

**The fix is custom SMTP.** Any real sender works. Resend is the fastest to
stand up and free at this scale:

1. Create an account at <https://resend.com> and add your sending domain (or use
   their test domain while you are trying it).
2. Create an API key.
3. In Supabase → **Project Settings → Authentication → SMTP Settings**, enable
   custom SMTP and fill in:

   ```
   Host      smtp.resend.com
   Port      465
   Username  resend
   Password  <your Resend API key>
   Sender    no-reply@<your domain>
   Sender name  Collage-Team
   ```

4. Save, then send yourself a reset from the app.

SendGrid, Postmark, Mailgun and AWS SES are all equally fine; the only thing
that matters is that it is not the built-in sender.

### If you do not have a domain: SendGrid, step by step

Resend's default `onboarding@resend.dev` sender only delivers to your own
account address, which is the built-in sender's failure wearing a different hat.
Without a domain to verify, use **SendGrid**: it offers *Single Sender
Verification*, where you prove you control one ordinary address — a personal
Gmail is fine — and can then send to anybody. No DNS, no domain. 100 messages a
day on the free plan, which covers a class.

**1. Make the account.** <https://signup.sendgrid.com>. Free plan, 100/day.
Signups go through an anti-abuse review, so it can be a few minutes before the
account is usable, and occasionally longer.

**2. Verify the address you will send from.**
Settings → **Sender Authentication** → *Single Sender Verification* → **Create
New Sender**. It asks for a From name, a From address, a reply-to, and a
physical mailing address — the last one is not optional and is not SendGrid
being nosy: CAN-SPAM requires a postal address in commercial mail. Your
department's address is fine.

SendGrid then emails that address a link. **Click it.** Until you do, every send
is refused.

**3. Make an API key.**
Settings → **API Keys** → **Create API Key** → Restricted Access, and switch on
**Mail Send** only. Nothing else on that page is needed, and a key that can only
send mail is a key that cannot do damage if it leaks.

The key starts `SG.` and is shown **once**. Copy it now; there is no second
chance to read it and the only remedy is to delete it and make another.

**4. Put it into Supabase.**
Project Settings → Authentication → **SMTP Settings** → enable custom SMTP:

```
Sender email   the address you verified in step 2, character for character
Sender name    Collage-Team
Host           smtp.sendgrid.net
Port           587           (465 also works; try the other if one is blocked)
Username       apikey        <- literally the word "apikey", not your key
Password       SG....        <- the key from step 3
```

**The failure everybody hits:** the Sender email here must be *exactly* the
verified sender. Not a different address at the same domain, not the same
address with a different capitalisation. SendGrid answers a mismatch with "The
from address does not match a verified Sender Identity" and drops the message.

**5. Raise the rate limit.** Authentication → Rate Limits. See §2 below — the
old ceiling survives the SMTP change and is what silently eats your second test.

**6. Test it, and look in two places.** Request a reset from the app, then check
SendGrid's **Activity Feed** (delivered / bounced / blocked, with the reason)
and Supabase's **Authentication → Logs**. Between them there is no failure that
stays invisible.

> A Gmail single sender will deliver, but SendGrid signs it with its own domain
> while the From says `@gmail.com`, so it is unaligned mail and
> `@college.harvard.edu` sits behind a filter that treats that with suspicion.
> Expect some of it in spam and say so when you tell people to look. An address
> at a domain you control, verified properly, is the real fix.

> Do not send from a `harvard.edu` address you do not control. It fails SPF and
> DKIM outright — the message is dropped rather than filed in spam.

**If SendGrid's review turns you down** — it happens on free signups — Brevo
(<https://brevo.com>, 300/day free, `smtp-relay.brevo.com`) verifies a single
sender the same way. Or buy a domain for about ten dollars a year and use
Resend, which is the version of this with no caveats attached.

---

## 2. The rate limit is still the default

**Authentication → Rate Limits → "Rate limit for sending emails".** The built-in
sender's ceiling stays in force until you raise it, so the second and third test
in an afternoon can silently do nothing even after SMTP is set up. Raise it to
something that fits a class — a few hundred an hour is not extravagant when
eighty students confirm their accounts in the same lecture.

There is also a per-address cooldown: asking for a second reset within about a
minute returns "For security purposes, you can only request this after N
seconds". That one **does** reach the screen, so if you are not seeing it, it is
not what is happening.

---

## 3. The link points somewhere that does not exist

**Authentication → URL Configuration.**

- **Site URL** must be the deployed origin, e.g. `https://<app>.vercel.app`. If
  it is still `http://localhost:3000`, every emailed link points at a port
  nothing runs on. (This app's dev server is on **5180**, not 3000.)
- **Redirect URLs** must cover the path the app asks to come back to. The app
  asks for `origin + pathname`, which is `https://<app>.vercel.app/ck`. If that
  is not allow-listed, Supabase ignores it and falls back to Site URL.

  Add both:

  ```
  https://<app>.vercel.app/**
  http://localhost:5180/**
  ```

A link that lands on the bare origin still works now — `app/page.tsx` carries
the URL fragment through to `/ck`, and the fragment is what proves whose
password it is. It did not before, which is a separate bug that is fixed.

---

## 4. The account does not exist

With email-enumeration protection on — the default, and it should stay on —
`resetPasswordForEmail` for an address with no account returns **success** and
sends nothing. The screen deliberately says the same thing either way, because
saying otherwise turns the reset box into a way to test whether somebody is
enrolled.

So if an account was deleted and recreated, or the address was typed with a
different spelling than the one it was registered under, the silence is correct
behaviour and no amount of SMTP configuration changes it. Check
**Authentication → Users** for the exact address.

---

## Confirming it worked

Send yourself a reset and watch **Authentication → Logs** in the dashboard. A
delivered message and a refused one look completely different there, and it is
the only place the difference is visible — the app cannot see it, by design.
