# Riftbound Training Center

Simulateur local du jeu de cartes Riftbound : partie contre une IA (adversaire débutant / adversaire confirmé / Pro Player) ou contre un joueur (même PC ou réseau local), en BO1 ou en BO3 avec sideboard entre les manches. Interface en français ou en anglais (Options ⚙, avec les volumes des sons).

Niveaux de l'IA : le débutant joue de façon gloutonne, le confirmé cherche la meilleure attaque et dépense ses runes au mieux, le Pro Player simule en plus chaque tour (plusieurs plans de tour et plusieurs attaques, joués deux tours plus loin sur des copies de la partie où la main adverse est tirée au hasard) et garde le meilleur.

## Lancer

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent. Aucune dépendance à installer.

- Windows : double-clic sur `Riftbound Training Center.exe` (ou `Lancer.bat`).
- Ailleurs : `npm start`, puis ouvrir http://localhost:3000

## En ligne (multijoueur à distance)

Le dépôt contient `render.yaml` : sur [render.com](https://render.com), New › Blueprint › ce dépôt › Apply.
Chaque `git push` sur `main` redéploie le site. Les deux joueurs ouvrent l'adresse du site ; l'un crée une partie
(Contre un joueur › Créer), l'autre la rejoint avec le tag.

Limites de l'offre gratuite : le serveur s'endort après un moment sans visite (réveil ~1 min), et les decks créés
en ligne sont perdus à chaque redéploiement (disque non persistant). Pas de compte ni de mot de passe : qui a le tag
peut entrer dans la partie.

## Tests

```
npm test
```

Vérifie les règles du moteur et fait jouer des parties IA contre IA sur les vrais decks.

```
node stress.js [parties par deck=2] [niveau=normal] [filtre sur le nom du deck]
```

Banc d'essai joueur contre IA : un robot joue le siège humain en mode manuel (paiement, redressement, pioche et
combats à la main, cartes et cibles parfois au hasard, réponses sur la pile) contre la vraie IA, sur tous les decks.
Il signale les blocages (personne ne peut agir), les plantages et les actions refusées en boucle.

```
node e2e.js [parties=6] [niveau=normal]
```

Parties complètes à travers le vrai serveur (HTTP, SSE et tours de l'IA avec leurs pauses, accélérées), comme le
navigateur. Échoue si la partie s'arrête de bouger. À lancer après toute modification de `server.js` ou de `ai.js`.

`node seed-legend-decks.js` ajoute un deck de test légal pour chaque légende qui n'en a pas (`data/decks.json`).

## Organisation

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur HTTP + SSE, salons, tours de l'IA |
| `game.js` | Moteur de jeu (actions, pile, affrontements, combat, effets) |
| `rules.js` | Lecture des textes de cartes : mots-clés, coûts, effets (`CARD_FX` pour les cartes écrites à la main) |
| `ai.js` | IA |
| `public/` | Interface (`app.js`, `style.css`, `index.html`, `i18n.js` : traduction anglaise) |
| `data/cards.json` | Cache des cartes (rechargeable depuis l'interface) |
| `data/decks.json` | Decks |
| `assets/` | Logo, icône, source du lanceur `.exe` |

Reconstruire le lanceur (Windows, compilateur .NET Framework) :

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /r:System.Windows.Forms.dll /win32icon:assets\icon.ico /out:"Riftbound Training Center.exe" assets\launcher.cs
```
