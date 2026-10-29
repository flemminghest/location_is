# ByggeInfo — ejendomsanalyseprototype

Dansk responsiv webapp til forundersøgelse af ejendomme for bygningskonstruktør-studerende.

## Aktuelle integrationer

- **Adresseforslag:** serverless-proxy til Klimadatastyrelsens Adressevælger, husnummersøgning i hele Danmark.
- **BBR:** serverless endpoint forsøger at hente BBR-bygning via adressens DAR-husnummer/BBR-relation fra Datafordelerens Flexible GraphQL v3.
- **Matrikel:** serverless endpoint forsøger at hente jordstykke/matrikel via DAR-husnummerets dokumenterede relation til MAT-jordstykke.
- **Plandata.dk:** serverless WFS-opslag på vedtagne lokalplaner, delområder, byggefelter, kommuneplanrammer og zonekort i et lille søgevindue omkring adressepunktet.
- **Status:** `GET /api/status` tester nu Datafordelerens forbindelse og om GraphQL-skemaer for DAR, BBR og MAT kan tilgås. At miljøvariablen findes er ikke i sig selv en live test.
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

## Vigtige forbehold

- BBR- og matrikelkoblinger afhænger af aktuelle GraphQL-skemaer og relationer. Brug `/api/status` først og kontrollér originaldata.
- BBR-arealer er registeroplysninger og er ikke nødvendigvis identiske med opmålte arealer.
- Grundareal, bebygget areal, boligareal og etageareal er forskellige størrelser og må ikke forveksles.
- Lokalplan, kommuneplan, byggeregler, terræn, miljø, forurening og andre kilder er endnu ikke fuldt live-integreret.
- Dette er et studie-/forprojektværktøj, ikke en myndighedsafgørelse eller dokumentation for lovlighed.
