# Budget planner

Planificator personal de buget, cu istoric lunar și proiecție zi-cu-zi a soldului pentru o călătorie.

Rulează pe Next.js 16 + Supabase (Postgres), cu autentificare Clerk, și e gândit să fie deployat pe Vercel — ca să fie accesibil și de pe telefon.

## Punere în funcțiune

Ai nevoie de un cont Supabase și unul Clerk. Ambele au plan gratuit suficient pentru o aplicație personală.

### 1. Baza de date (Supabase)

1. Creează un proiect nou pe [supabase.com](https://supabase.com).
2. În **SQL Editor**, rulează pe rând, în ordine, fișierele din [`supabase/migrations/`](supabase/migrations/)
   (`0001_init.sql` → `0005_mdl_currency.sql`). Toate sunt aditive, deci pot rula înainte de deploy.
3. Ia connection string-ul: butonul **Connect** din dashboard → tab-ul **Transaction pooler**.
   Trebuie să fie **portul 6543**, nu 5432 — transaction mode e cel potrivit pentru
   funcții serverless, care deschid multe conexiuni scurte.

### 2. Autentificare (Clerk)

1. Creează o aplicație pe [clerk.com](https://clerk.com).
2. Copiază cheile din **API keys**.
3. Oricine își poate face cont (`/sign-up`), iar datele sunt separate per utilizator
   (coloana `user_id` pe fiecare tabel). Dacă vrei să restricționezi cine se poate
   înregistra, folosește din dashboard-ul Clerk: **User & Authentication → Restrictions**.
4. După ce rulezi `supabase/migrations/0003_multi_user.sql`, datele existente (cu
   `user_id` NULL) nu sunt vizibile nimănui până nu le atribui contului tău:
   `node --env-file=.env.local scripts/claim-legacy-data.mjs user_xxx`
   (userId-ul îl găsești în Clerk Dashboard → Users).

### 3. Configurare locală

```bash
cp .env.example .env.local
```

Completează valorile în `.env.local`, apoi:

```bash
npm install
npm run dev
```

### 4. Mutarea datelor vechi din SQLite

Dacă vii de la versiunea locală cu `data/budget.db`:

```bash
node --env-file=.env.local scripts/migrate-data.mjs
```

Scriptul citește `data/budget.db` (nu îl modifică niciodată), scrie tot în Postgres
într-o singură tranzacție și refuză să pornească dacă în Postgres există deja date —
`--force` șterge și reimportă. La final resetează secvențele de ID.

### 5. Deploy pe Vercel

```bash
npx vercel
```

Apoi adaugă în **Project Settings → Environment Variables** aceleași variabile din
`.env.local`. Fără ele, aplicația pornește dar refuză accesul.

## Variabile de mediu

| Variabilă | Ce e |
|---|---|
| `DATABASE_URL` | Connection string Supabase, transaction pooler (**port 6543**) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Cheia publică Clerk |
| `CLERK_SECRET_KEY` | Cheia secretă Clerk |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in` și `/sign-up` |
| `DATABASE_SSL_NO_VERIFY` | Opțional, `1` doar dacă apare eroare de certificat |

## Structură

- `app/page.tsx` — dashboard „Averea mea": conturi, snapshot-uri, verdicte
- `app/plati/page.tsx` — plăți recurente și planificate, ce urmează și ce e restant
- `app/istoric/page.tsx` — istoric, navigare între snapshot-uri
- `app/trip/page.tsx` — proiecție călătorie cu calendar zi-cu-zi al soldului
- `lib/db.ts` — pool Postgres + helperele `query` / `queryOne` / `execute` / `withTransaction`
- `lib/queries.ts` — funcțiile CRUD (async)
- `lib/balance.ts` — calculul soldului zi-cu-zi (ține cont de ziua exactă de încasare/plată:
  salariu în a N-a zi lucrătoare, chirie la final de lună, etc.)
- `lib/verdict.ts` — compară două snapshot-uri de avere cu delta așteptată
- `lib/bnr.ts` — cursul oficial BNR (EUR, MDL), adus la cerere de pe curs.bnr.ro și salvat în `exchange_rates`
- `lib/dates.ts` — zile lucrătoare și sărbători legale românești
- `lib/auth.ts` — verificarea sesiunii Clerk (`requireUser()`)
- `proxy.ts` — protecția rutelor (în Next 16 `middleware.ts` s-a redenumit `proxy.ts`)
- `supabase/migrations/` — schema bazei de date
- `scripts/migrate-data.mjs` — mutarea datelor din vechiul SQLite

`balance.ts`, `verdict.ts` și `dates.ts` sunt funcții pure — nu ating baza de date.

## Note despre securitate

Aplicația ține date financiare personale, deci:

- Accesul la Postgres se face **exclusiv server-side**. Nicio cheie de bază de date nu
  ajunge în browser.
- Toate tabelele au RLS activat **fără policies**, plus grant-urile revocate pentru
  rolurile `anon` și `authenticated`. Adică nici dacă Data API-ul public al Supabase e
  pornit, nu se poate citi nimic cu cheia publică.
- Fiecare route handler verifică sesiunea prin `requireUser()`, nu doar `proxy.ts` —
  documentația Next spune explicit că Proxy e pentru verificări optimiste, nu pentru
  autorizare completă.
- Fiecare interogare din `lib/queries.ts` filtrează după `user_id` (inclusiv UPDATE/DELETE
  după `id`), deci un utilizator nu poate citi sau modifica datele altuia, nici ghicind
  un `id`. Rândurile cu `user_id` NULL nu sunt vizibile nimănui.

## Cum se folosește

1. În „Averea mea" adaugi conturile (BT, cash RON, cash EUR, cont în MDL...) și, periodic, notezi
   cât ai în fiecare — asta e un *snapshot*. Aplicația compară fiecare snapshot cu cel
   anterior și îți spune dacă te-ai încadrat în bugetul zilnic sau l-ai depășit.
2. În „Plăți" pui recurentele (chirie pe 30, salariu în a 4-a zi lucrătoare) și plățile
   unice cu dată exactă.
3. În „Călătorie" pui data și vezi graficul soldului zi cu zi până atunci, inclusiv
   punctul minim — util ca să vezi dacă rămâi pe minus între chirie și salariu.
