# Riftbound Training Center

Simulateur local du jeu de cartes Riftbound : partie contre une IA (facile / normale / difficile) ou contre un joueur (même PC ou réseau local).

## Lancer

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent. Aucune dépendance à installer.

- Windows : double-clic sur `Riftbound Training Center.exe` (ou `Lancer.bat`).
- Ailleurs : `npm start`, puis ouvrir http://localhost:3000

## Tests

```
npm test
```

Vérifie les règles du moteur et fait jouer des parties IA contre IA sur les vrais decks.

## Organisation

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur HTTP + SSE, salons, tours de l'IA |
| `game.js` | Moteur de jeu (actions, pile, affrontements, combat, effets) |
| `rules.js` | Lecture des textes de cartes : mots-clés, coûts, effets (`CARD_FX` pour les cartes écrites à la main) |
| `ai.js` | IA |
| `public/` | Interface (`app.js`, `style.css`, `index.html`) |
| `data/cards.json` | Cache des cartes (rechargeable depuis l'interface) |
| `data/decks.json` | Decks |
| `assets/` | Logo, icône, source du lanceur `.exe` |

Reconstruire le lanceur (Windows, compilateur .NET Framework) :

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /r:System.Windows.Forms.dll /win32icon:assets\icon.ico /out:"Riftbound Training Center.exe" assets\launcher.cs
```
