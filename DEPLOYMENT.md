# TTK vintertraening deployment

Denne branch gør Vercel-frontenden klar til at bruge den rigtige backend uden at ændre den aktive sommerløsning.

Den bruges også som test-branch for det nye Vercel-projekt, indtil vi aktivt vælger at merge eller flytte trafik.

## Hvad ændres

Frontend får et sikkert admin-login med Google OAuth. Kun mailadresser i `ADMIN_EMAILS` får adgang til `/admin`. Admin-kald går gennem Vercel API'et, som sender et hemmeligt token videre til Apps Script, så vinterdata kan skrives uden at tokenet ligger i browseren.

Backend-scriptet udvides med `season=summer|winter`. Sommer bruger fortsat de eksisterende sheets: `Players`, `Assignments`, `ExtraHolds` og `SwapRequests`. Vinter bruger nye sheets: `WinterPlayers`, `WinterAssignments`, `WinterExtraHolds` og `WinterSwapRequests`.

## Vercel miljøvariabler

Sæt disse under Vercel project settings for det projekt, der peger på repoet `ttk-holdplan`.

`GOOGLE_CLIENT_ID` er client ID fra Google Cloud OAuth JSON-filen.

`GOOGLE_CLIENT_SECRET` er client secret fra Google Cloud OAuth JSON-filen.

`AUTH_SECRET` er en lang tilfældig tekst til signering af login-cookien. Lav den for eksempel med `openssl rand -base64 32`.

`ADMIN_EMAILS` er en kommasepareret liste med de Google-konti, der må logge ind, for eksempel `teresa@example.com,jacob@example.com`.

`TTK_APPS_SCRIPT_URL` er URL'en til den aktive Apps Script web app.

`TTK_BACKEND_TOKEN` er en lang tilfældig tekst, som også skal sættes i Apps Script Script Properties med samme navn.

## Google OAuth

OAuth-clienten skal være typen Web application.

Authorized JavaScript origins skal indeholde det Vercel-domæne, du vælger.

Authorized redirect URIs skal indeholde `https://DIT-VERCEL-DOMAENE/api/auth/callback/google`.

Hvis du tester på et Vercel preview-link, skal preview-linkets origin og callback også tilføjes.

## Apps Script

Før vinter-admin kan skrive data, skal Apps Script have Script Property `TTK_BACKEND_TOKEN` med samme værdi som i Vercel.

Når branchens kode er godkendt, skal Apps Script-koden deployes som en ny version af web app'en. Den aktive sommerløsning fortsætter med samme URL og samme sommer-sheets.

## Godkendelsesrækkefølge

Først sættes Vercel miljøvariabler og Google OAuth URLs.

Derefter sættes `TTK_BACKEND_TOKEN` i Apps Script Script Properties.

Derefter deployes Apps Script som ny version.

Til sidst deployes/merges Vercel-frontenden og testes med en vinter-CSV.
