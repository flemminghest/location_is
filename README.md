# ByggeInfo — ejendomsanalyseprototype

Dansk, responsiv prototype rettet mod bygningskonstruktør-studerende. Søgning efter danske adresser, ejendomsoverblik, arealer, kortlag, lokalplaner, byggeregler, miljø, infrastruktur og kildestatus.

## Status
- Adresseforslag: primært fra Danmarks Adresseregister/ Dataforsyningens adresse-autocomplete API, med OpenStreetMap/Photon som fallback.
- BBR: **ikke endnu live-integreret**. UI viser ingen opdigtede BBR-oplysninger.
- Matrikel: **ikke endnu live-integreret**. Grundareal, matrikelgrænser og matrikelidentifikation kræver integration til Dataforsyningen/Matrikeldata.
- Lokalplan, miljø, terræn og andre forhold: kildelinks og tjeklister findes, men der er ikke endnu live-data.
- Alle oplysninger som ikke er hentet fra en officiel kilde, skal vises som manglende/ikke verificerede.

## BBR og matrikel — arkitektur for næste trin
Tilslut offentlige tjenester gennem et backend-proxy, hvor nødvendigt:
1. Adresse -> officiel adresseidentifikator (DAR).
2. Adresseidentifikator -> BFE-/ejendomsidentifikation og BBR-enheder/bygningsoplysninger.
3. BFE-/matrikelidentifikation -> matrikelnummer, ejerlav og registreret matrikelareal.
4. Vis kilde, tidspunkt, datadækning og status på hvert felt.
5. Skeln tydeligt mellem registrerede arealer, beregnede værdier og juridisk vurdering.

Undgå at lægge private API-nøgler i frontend. Kontrollér gældende adgangsvilkår, CORS, rate limits og autentifikation hos de offentlige datatjenester før produktionsbrug.

## Kørsel
Åbn `index.html` i en browser eller udgiv den som en statisk webside. Adresseforslag kræver internetadgang. Der er i øjeblikket ingen backend og ingen live BBR-/matrikelintegration.

## Officielle udgangspunkter
- Dataforsyningen: https://dataforsyningen.dk/
- BBR: https://bbr.dk/
- Plandata: https://www.plandata.dk/
- Bygningsreglementet: https://www.bygningsreglementet.dk/
- Danmarks Miljøportal / Arealinformation: https://arealinformation.miljoeportal.dk/

**Fagligt forbehold:** Denne prototype er ikke en myndighedsafgørelse eller dokumentation for lovlighed. Kontroller altid originale registerdata og gældende plan- og byggeregler.
