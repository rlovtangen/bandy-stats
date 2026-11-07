# bandy-stats
Sammenstilling av spillerstatistikk fra Bandyforbundets kampsenter.
Primært laget for innebandy, men fungerer sannsynligvis også for kampsenter for bandy og landhockey.

## Installasjon
Krever [Node.js](https://nodejs.org)

## Bruk

```
node bandy-stats.js <turnerings-id>
```

Du finner turnerings-id ved å gå til Bandyforbundets kampsenter og velge det ønskede turneringen.  Turneringens ID vil være en tallkombinasjon i URLen til turneringen.
F.eks. for OABR G14 høst 2026: https://bandyforbundet.no/innebandy/?page_id=15828#/sport/72/season/201073/region/447855/tournament/450237/tab/0  
Her er turnerings-id 450237, og kommandoen blir da
```
node bandy-stats.js 450237>
```

Resultatet er en CSV-fil som kan åpnes i Numbers (Mac) eller Excel (ikke testet).  
I tillegg skriver programmet ut en oversikt til terminalen.

## Hvorfor?
Spillerstatistikk mangler for enkelte turneringer, selv om all informasjon fra kampene fra G13/J13 og oppover ligger åpent i kampsenteret.
Dette programmet tilgjengeliggjør ingen annen informasjon enn det som er publisert i kampsenteret, men sammenstiller en oversiktlig statistikk.

## AI
Koden i dette prosjektet er Vibe-kodet vha [Claude Code](claude.ai)
