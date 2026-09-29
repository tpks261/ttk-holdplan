# TTK vintertraening deployment

## Fælles sæsonadmin (september 2026)

`/admin` åbner nu `admin-app.html`, med sommeradminens farver og arbejdsgang,
eksplicit sæsonvalg og de eksisterende dataark. De to tidligere filer
`Admin.html` og `admin.html` bevares uændret i Git. De har kolliderende navne
på en almindelig Mac-disk; stage derfor aldrig dem som en utilsigtet ændring.

Et Git-push ændrer kun koden. Der køres ingen migration, nulstilling, import,
prøvedata eller automatisk gemning ved opstart/sæsonskift. Den nye CSV-import
forhåndsvises og tilføjer kun nye navne; eksisterende spillere springes over.
Alle tildelinger, også ukendte holdnumre, bevares indtil en admin aktivt ændrer dem.

### Aktivering af baner og kapacitet

Vercel-udgaven kan læse eksisterende data og tildele hold med den tidligere
Apps Script-version. For at gemme baner/kapaciteter og få låst validering af
samtidige ændringer skal repoets `apps-script` aktiveres som en ny version af
den **eksisterende** Apps Script-webapp. Bevar spreadsheet, deployment-URL,
Script Properties og `TTK_BACKEND_TOKEN`. Kør ingen reset- eller seed-funktion.
Vercel-push opdaterer ikke automatisk Apps Script.

Holdindstillinger tilføjes først ved et aktivt klik på Gem og ligger i separate
Script Properties: `TTK_ADMIN_SETTINGS_summer` og `TTK_ADMIN_SETTINGS_winter`.
Disse ændrer ikke Players/Assignments-arkene. Hvis kapaciteten sænkes under
belægningen, vises en advarsel, og ingen spillere fjernes. Manglende indstillinger
læses med de eksisterende standarder (sommer 6, vinter 4); de skrives ikke ved load.
Den nye admin viser en klar besked og deaktiverer indstillingsgemning, hvis
backenden endnu ikke melder understøttelse. Godkendelse af holdbytte kræver også
den nye backend, så vinterens kapacitet overholdes.

Dette ændrer kun administrationen. De offentlige siders statiske skematekster
og den gamle Google Sites-admin følger ikke de nye baneindstillinger automatisk.

### Kontrol

`node --test tests/admin.test.cjs` tester CSV, ønsker, sæsonadskillelse, bevarelse
af eksisterende rækker, kapacitet og ændringskonflikter med isolerede data.
`node tests/admin-ui.cjs` bruger Playwright og isolerede browserfixtures; ingen
live API-kald foretages. Sæt evt. `CHROME_PATH` til en lokal Chrome-installation.
Efter deployment kontrolleres `/admin` og offentlige datatællinger for begge
sæsoner uden testskrivninger til live-arkene.

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
