# ByggeInfo — ejendomsanalyseprototype

Dansk responsiv webprototype for ejendomsopslag, særligt til brug i studier og forprojektering for bygningskonstruktører.

## Integrationer i repoet

- **Adressesøgning:** Backend-proxy til Dataforsyningens officielle danske adresse-autocomplete. OpenStreetMap/Photon bruges kun som fallback i browseren.
- **BBR:** Endpoint `GET /api/ejendom?adresseId=<DAR-adresse-id>` forsøger at følge adresse → husnummer → BBR-bygning via Datafordelerens Flexible GraphQL API.
- **Matrikel:** Samme ejendomsopslag forsøger at følge adressens relation til MAT-jordstykke og hente matrikelattributter. Der findes også et separat `GET /api/matrikel?q=...` endpoint, som kan tilpasses det aktuelle MAT-skema.
- **Status:** Backend og datakobling er implementeret i denne commit, men integrationen kan først returnere registrets rigtige oplysninger, når den er konfigureret med en gyldig Datafordeler API-nøgle og afprøvet mod den adgang, der er givet til API-nøglen. Den viste prototype må ikke opfattes som bevis på, at hvert felt allerede er hentet.

Kilde: Datafordelerens BBR GraphQL og Flexible GraphQL-dokumentation:
- https://datafordeler.dk/dataoversigt/bygnings-og-boligregistret-bbr/bbr-graphql/
- https://confluence.kds.dk/display/DML/Udvalgte%2BREST-tjenester%2Bomsat%2Btil%2BGraphQL-queries
- https://docs.dataforsyningen.dk/

## Kør lokalt

Kræver Node.js 20 eller nyere.

```bash
npm install
cp .env.example .env
# Redigér .env og indsæt din egen API key fra Datafordelerens portal
npm start
```

Åbn derefter `http://localhost:3000`.

## Konfiguration af BBR og matrikel

1. Opret/brug en konto og et IT-system på https://portal.datafordeler.dk/.
2. Opret en API key til de relevante registre/tjenester.
3. Sæt nøglen i serverens miljøvariabel `DATAFORDELER_API_KEY`.
4. Hvis hostingen understøtter det, opret miljøvariablen i hostingens Secret/Environment settings. **Læg aldrig nøglen i `index.html`, en offentlig fil eller Git.**
5. Genstart serveren og kontrollér `GET /api/status`.
6. Afprøv med adresser fra flere kommuner. Kontrollér hvert areal, bygningsattribut og matrikel-id mod de officielle registre. Datafordelerens GraphQL-skemaer og relationer kan ændre sig, så dette bør være en del af vedligeholdelsen.

Den officielle Datafordeler-dokumentation beskriver BBR GraphQL som adgangsstyret med API key/OAuth, og den nye model kan returnere bygninger, enheder, grunde og ejendomsrelationer. Den konkrete adgang kan afhænge af brugerens opsætning og tildelte rettigheder.

## API-endpoints

- `GET /api/health` — sundhedstjek
- `GET /api/status` — viser om API key er konfigureret
- `GET /api/adresser?q=<tekst>` — officielle adresseforslag
- `GET /api/ejendom?adresseId=<id>` — forsøg på at hente BBR- og matrikeldata for adresse
- `GET /api/ejendom?bfe=<BFE-nummer>` — matrikelrelateret opslag via BFE
- `GET /api/matrikel?q=<matrikelnummer>` — matrikelsøgning

## Vigtige forbehold

- BBR-arealer er registeroplysninger; de er ikke nødvendigvis det samme som opmålte arealer.
- Matrikel, BBR, planforhold og andre kilder beskriver forskellige juridiske/faglige forhold. Værdier må ikke blandes uden at vise kilde og betydning.
- Manglende API-resultat må aldrig omsættes til “forholdet findes ikke”. Prototypen skal vise tomme værdier og kildestatus.
- Datafordelerens brugsvilkår og eventuelle regler for personoplysninger skal overholdes.
- Denne prototype er ikke en myndighedsafgørelse eller dokumentation for lovlighed. Kontrollér altid original kilde og gældende regler.

## Officielle kilder

- Datafordeleren: https://www.datafordeler.dk/
- Dataforsyningen: https://dataforsyningen.dk/
- BBR: https://bbr.dk/
- Plandata: https://www.plandata.dk/
- Bygningsreglementet: https://www.bygningsreglementet.dk/
- Danmarks Arealinformation: https://arealinformation.miljoeportal.dk/
