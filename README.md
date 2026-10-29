# ByggeInfo — ejendomsanalyseprototype

Dansk responsiv webapp til forundersøgelse af ejendomme for bygningskonstruktør-studerende.

## Aktuelle integrationer

- **Adresseforslag:** serverless-proxy til Klimadatastyrelsens Adressevælger, husnummersøgning i hele Danmark.
- **BBR:** serverless endpoint forsøger at hente BBR-bygning via adressens DAR-husnummer/BBR-relation fra Datafordelerens Flexible GraphQL v3.
- **Matrikel:** serverless endpoint forsøger at hente jordstykke/matrikel via DAR-husnummerets dokumenterede relation til MAT-jordstykke.
- **Plandata.dk:** serverless WFS-opslag på vedtagne lokalplaner, delområder, byggefelter, kommuneplanrammer, zonekort, planforslag, aflyste planer og versioner. Planhistorikken viser registrerede forslag-, vedtagelses-, ikrafttrædelses-, aflysnings- og registerdatoer, når felterne findes.
- **Områdehistorik:** ny sektion sammenholder BBR-opførelsesår og daterede planhændelser i et nærområde på ca. 500 m. Den linker også til HistoriskeKort.dk/Kortviseren for ældre kort og luftfotos, som endnu skal gennemgås manuelt.
- **Status:** `GET /api/status` tester live adgang med tre separate GraphQL-forespørgsler — én for DAR, én for BBR og én for MAT. De bruger ikke introspektion, aliases eller flere rod-entiteter i samme forespørgsel, da Flexible GraphQL afviser disse mønstre. At miljøvariablen findes er ikke i sig selv en live test.
- **Kildemærkning:** UI må kun vise arealer, når kilden returnerer en værdi; manglende data vises som manglende og må ikke udlægges som “forholdet findes ikke”.

## Officielle dokumentationer

- Adressevælger og DAR-relationer: https://confluence.kds.dk/pages/viewpage.action?pageId=187105632
- BBR GraphQL v3: https://confluence.kds.dk/pages/viewpage.action?pageId=219513710
- MAT GraphQL v3: https://confluence.kds.dk/pages/viewpage.action?pageId=234782932
- Fleksibel opslagslogik: https://confluence.kds.dk/display/DML/Fleksibel%2Bopslagslogik

## API-ruter

- `GET /api/status` — tester konfiguration og schemaadgang (viser aldrig API-nøglen)
- `GET /api/adresser?q=<tekst>` — husnummer-/adresseforslag fra Adressevælgeren
- `GET /api/ejendom?husnummerId=<DAR-id>` — forsøger BBR og MAT-opslag ud fra valgt husnummer
- `GET /api/ejendom?adresseId=<DAR-adresse-id>` — løser adresse til husnummer, derefter BBR/MAT
- `GET /api/ejendom?bfe=<BFE-nummer>` og `GET /api/matrikel?bfe=<BFE-nummer>` — MAT-opslag via BFE-nummer

## Sikker drift

Sæt `DATAFORDELER_API_KEY` som en **Sensitive** miljøvariabel i Vercel Production. Opret aldrig en API-nøgle i frontend eller commit den til Git. Adressevælgeren bruger den dokumenterede offentlige demo-token som standard; hvis dens vilkår ændrer sig, kan `ADRESSEVAELGER_TOKEN` tilføjes som miljøvariabel.

## Nye funktioner og faglig værdi

- **Historik og område**: kort historik ud fra faktiske BBR- og Plandata-datoer; links til arkivkort og luftfotos.
- **Planens tidslinje**: versionsnumre og registrerede datoer vises separat fra juridiske ændringer. Rettelser af attributter/geometri er ikke i sig selv bevis for ændrede planbestemmelser.
- **Forprojektscreening**: anbefalet næste trin er en risikoliste, myndighedstjekliste, sammenligning af eksisterende forhold mod planbestemmelser, terræn/regnvand/fundering og en kildesporbar rapport.

## Vigtige forbehold

- BBR- og matrikelkoblinger afhænger af aktuelle GraphQL-skemaer og relationer. Brug `/api/status` først og kontrollér originaldata.
- BBR-arealer er registeroplysninger og er ikke nødvendigvis identiske med opmålte arealer.
- Grundareal, bebygget areal, boligareal og etageareal er forskellige størrelser og må ikke forveksles.
- Lokalplan, kommuneplan, byggeregler, terræn, miljø, forurening og andre kilder er endnu ikke fuldt live-integreret.
- Dette er et studie-/forprojektværktøj, ikke en myndighedsafgørelse eller dokumentation for lovlighed.
