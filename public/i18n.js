'use strict';
/* Language: French (default) or English (Options > Langue). The interface is written in French; in English it is
   translated as it renders: text nodes, title / placeholder attributes, and the game log through its message
   templates. Card names and rules text stay as printed (English, like the official French card gallery). */
const LANG = (() => { try { return JSON.parse(localStorage.getItem('rtc.lang')) || 'fr'; } catch { return 'fr'; } })();

// exact strings
const EN = {
  // title, menu, decks
  'Appuyez sur une touche': 'Press any key', 'Jouer': 'Play', 'Contre l\'IA ou contre un joueur avec un tag': 'Against the AI or a player with a tag',
  'Mes decks': 'My decks', 'Importer, construire, gérer vos listes': 'Import, build and manage your lists', 'Base de cartes': 'Card database',
  'Chargement…': 'Loading…', '← Menu': '← Menu', '+ Nouveau deck': '+ New deck', 'Importer une liste': 'Import a list',
  'Importez une liste ou créez un deck pour commencer.': 'Import a list or create a deck to begin.', 'Survolez une carte': 'Hover a card',
  'Message… (Entrée)': 'Message… (Enter)',
  'Projet d\'entraînement non officiel, local. Riftbound et les visuels appartiennent à Riot Games. Images affichées depuis leurs serveurs, jamais copiées.':
    'Unofficial local training project. Riftbound and its artwork belong to Riot Games. Images are shown from their servers, never copied.',
  'Chargement de la base (le premier lancement peut prendre ~1 min)…': 'Loading the card database (the first launch can take ~1 min)…',
  ' (cliquer pour réessayer)': ' (click to retry)', 'Mise à jour depuis Riftcodex…': 'Updating from Riftcodex…', 'Base de cartes à jour': 'Card database up to date',
  'Légende': 'Legend', 'Champion choisi': 'Chosen champion', 'Deck principal': 'Main deck', 'Champs de bataille': 'Battlefields', 'Runes': 'Runes',
  'Réserve (side)': 'Sideboard', 'Deck importé': 'Imported deck', 'Aucun deck': 'No deck', 'Sans légende': 'No legend', 'Liste copiée': 'List copied',
  'Copier la liste': 'Copy list', 'Dupliquer': 'Duplicate', 'Supprimer': 'Delete', 'Définir comme champion choisi': 'Set as chosen champion',
  'Vers la réserve': 'To sideboard', 'Vers le deck': 'To deck', 'Retirer': 'Remove', 'Ajouter': 'Add',
  'Rechercher une carte (nom, texte, tag)…': 'Search a card (name, text, tag)…', 'Tous types': 'All types', 'Tous domaines': 'All domains',
  'Ajouter des cartes': 'Add cards', 'Nouveau deck': 'New deck', 'Nom du deck': 'Deck name', 'Annuler': 'Cancel', 'Importer': 'Import',
  'Base de cartes non chargée.': 'Card database not loaded.', 'Deck importé': 'Deck imported', 'variantes': 'variants',
  'Unité': 'Unit', 'Sort': 'Spell', 'Équipement': 'Gear', 'Champ de bataille': 'Battlefield', 'Rune': 'Rune', 'Jeton': 'Token',
  // lobby
  'Contre l’IA': 'Against the AI', 'Contre un joueur': 'Against a player', 'Adversaire débutant': 'Beginner opponent', 'Adversaire confirmé': 'Skilled opponent', 'Pro Player': 'Pro Player',
  'Joue simplement : prend les champs de bataille, lance quelques sorts, fait des erreurs.': 'Plays simply: takes battlefields, casts a few spells, makes mistakes.',
  'Joue bien : sorts au bon moment, contres, réactions en combat, retrait ciblé.': 'Plays well: spells at the right time, counters, combat reactions, targeted removal.',
  'Impitoyable : calcule chaque attaque et la riposte, ne gaspille rien, punit chaque erreur.': 'Ruthless: computes every attack and the counter-attack, wastes nothing, punishes every mistake.',
  'Votre deck': 'Your deck', 'Deck de l’IA': 'AI deck', 'Même deck que vous': 'Same deck as you', '— Votre deck —': '— Your deck —', '🎲 Aléatoire': '🎲 Random',
  'Format': 'Format', 'BO1 (une partie)': 'BO1 (one game)', 'BO3 (deux manches gagnantes)': 'BO3 (best of three)', 'Lancer la partie': 'Start the game',
  'Votre nom': 'Your name', 'Créer une partie': 'Create a game', 'Un tag est généré : donnez-le à votre adversaire.': 'A tag is generated: give it to your opponent.',
  'Créer': 'Create', 'Rejoindre': 'Join', 'ou': 'or', 'Choisissez votre deck': 'Choose your deck', 'Donnez ce tag à votre adversaire': 'Give this tag to your opponent',
  'Cliquer pour copier': 'Click to copy', 'Tag copié': 'Tag copied', 'En attente de l’adversaire…': 'Waiting for the opponent…', 'Il ouvre ': 'They open ',
  ', clique sur Jouer › Contre un joueur et entre le tag.': ', click Play › Against a player and enter the tag.',
  'Aucun deck : allez dans « Mes decks » pour en importer un.': 'No deck: go to “My decks” to import one.',
  // board
  'Base': 'Base', 'Deck': 'Deck', 'Défausse': 'Trash', 'Deck de runes': 'Rune deck', 'Bannis': 'Banishment', 'Réserve de runes': 'Rune pool', 'Votre main': 'Your hand', 'Main': 'Hand',
  'Clic : piocher · Clic droit : options': 'Click: draw · Right-click: options', 'Deck adverse': 'Opponent’s deck',
  'Clic : canaliser une rune · Clic droit : options': 'Click: channel a rune · Right-click: options', 'Deck de runes adverse': 'Opponent’s rune deck',
  'Clic : voir la défausse': 'Click: view the trash', 'Clic : voir les cartes bannies': 'Click: view banished cards',
  'Clic : épuiser / redresser une rune (+1 énergie en réserve)': 'Click: exhaust / ready a rune (+1 energy in pool)',
  'Contrôle (clic : moi / clic droit : adversaire)': 'Control (click: me / right-click: opponent)', 'Combat (unités des deux côtés) ou conquête (+1 point)': 'Combat (units on both sides) or conquer (+1 point)',
  'Carte cachée (Hidden)': 'Hidden card', 'Votre carte cachée (Hidden) : glissez ici une carte [Hidden] de votre main': 'Your hidden card: drag a [Hidden] card from your hand here',
  'Énergie en réserve': 'Energy in pool', 'de n’importe quel domaine': 'of any domain', 'au choix': 'any', '◆ au choix': '◆ any',
  'CACHÉE': 'HIDDEN', 'PUISSANTE': 'MIGHTY', 'RENFORCÉE': 'EMPOWERED', 'ÉTOURDI': 'STUNNED', 'RÉVÉLÉE': 'REVEALED', 'attaché': 'attached',
  // HUD, dock
  'Tour': 'Turn', 'Joueur actif': 'Active player', 'Expérience (XP) — clic : +1, clic droit : −1': 'Experience (XP) — click: +1, right-click: −1',
  'Créer des jetons dans votre base (clic droit sur un champ de bataille pour les y créer)': 'Create tokens in your base (right-click a battlefield to create them there)',
  'Lancer un dé': 'Roll a die', 'Tag de la partie': 'Game tag', 'Quitter': 'Quit', 'Abandonner': 'Concede', 'Résultat': 'Result',
  'Quitter la partie ? Elle se termine pour les deux joueurs.': 'Leave the game? It ends for both players.',
  'Annuler ma dernière action (Ctrl+Z). Ce que l’adversaire a joué depuis est annulé aussi.': 'Undo my last action (Ctrl+Z). What the opponent played since is undone too.',
  'Mode auto activé : pioche, redressement, canalisation, points, combats, paiements et effets des cartes sont automatiques. Cliquez pour tout faire à la main.':
    'Auto mode on: draw, ready, channel, points, combat, payments and card effects are automatic. Click to do everything by hand.',
  'Mode manuel : vous faites tout à la main. Cliquez pour tout automatiser.': 'Manual mode: you do everything by hand. Click to automate everything.',
  'Mode': 'Mode', 'auto': 'auto', 'manuel': 'manual', 'Piocher': 'Draw', 'Canaliser': 'Channel', 'Redresser tout': 'Ready all', 'Fin de tour': 'End turn',
  'Passe la main. Le tour suivant démarre seul : unités et runes redressées, points de tenue, 2 runes canalisées, 1 carte piochée.':
    'Pass the turn. The next turn starts by itself: units and runes readied, hold points, 2 runes channeled, 1 card drawn.',
  'Oui': 'Yes', 'Non': 'No', 'Défausser 1 carte et canaliser 1 rune épuisée ?': 'Discard 1 card and channel 1 rune exhausted?',
  'Payer 1 énergie pour un jeton Gold épuisé ?': 'Pay 1 energy for an exhausted Gold token?', 'Payer 1 énergie pour redresser votre légende ?': 'Pay 1 energy to ready your legend?',
  'Payer 1 énergie pour piocher 1 ?': 'Pay 1 energy to draw 1?', 'Dépenser un buff pour piocher 1 ?': 'Spend a buff to draw 1?', 'Payer 4 puissance pour marquer 1 point ?': 'Pay 4 power to score 1 point?',
  'Canaliser 1 rune épuisée ?': 'Channel 1 rune exhausted?', 'Détruire une de vos unités ici pour piocher 1 ?': 'Kill one of your units here to draw 1?',
  'conquête': 'conquer', 'tenir': 'hold', 'défense': 'defend', 'combat': 'combat', 'début de tour': 'beginning phase', 'premier tour': 'first turn', 'carte cachée': 'hidden card',
  'Rockfall Path : aucune unité ne peut y être jouée.': 'Rockfall Path: units can’t be played here.',
  'À vous de répondre': 'Your response', 'Équiper un de vos équipements à cette unité (Weaponmaster) ?': 'Attach one of your Equipment to this unit (Weaponmaster)?',
  '✦ Jouer sans le coût additionnel': '✦ Play without the additional cost', '✦ Jouer avec le coût additionnel (payé à la main)': '✦ Play with the additional cost (paid by hand)',
  'Son': 'Sound', 'Options': 'Options', 'Force adverse ici': 'Enemy Might here', 'Votre force ici': 'Your Might here', 'Buff': 'Buff',
  // stack, prompts
  'champ de bataille': 'battlefield', ' (la vôtre)': ' (yours)', 'Son effet s’applique à la résolution.': 'Its effect applies on resolution.',
  'Effet non géré : appliquez-le à la main, puis :': 'Effect not handled: apply it by hand, then:',
  'Retire le sort de la pile sans appliquer son effet (à faire à la main)': 'Removes the spell from the stack without applying its effect (do it by hand)',
  'Sans effet': 'No effect', 'Résoudre': 'Resolve', 'Passer': 'Pass', 'Laisser résoudre': 'Let it resolve',
  'Répondez avec une [Reaction] (glissez-la sur le plateau), ou :': 'Respond with a [Reaction] (drag it onto the board), or:',
  'Ajoutez des attaquants, jouez une [Action]/[Reaction], ou :': 'Add attackers, play an [Action]/[Reaction], or:', 'À vous : jouez une [Action]/[Reaction], ou :': 'Your move: play an [Action]/[Reaction], or:',
  'la cible': 'the target', 'Lancer sans cible': 'Cast without a target', 'Activer': 'Activate', 'Lancer': 'Cast', 'Aucune cible': 'No target',
  'Votre carte': 'Your card', 'Détruisez un équipement': 'Kill a gear', 'Détruisez une unité': 'Kill a unit', 'Étourdissez une unité': 'Stun a unit', 'Redressez une unité': 'Ready a unit',
  'Renvoyez une unité en main': 'Return a unit to hand', 'Rappelez une unité': 'Recall a unit', 'Attachez l’équipement': 'Attach the gear', 'Doublez la force d’une unité': 'Double a unit’s Might',
  'Choisissez votre unité': 'Choose your unit', 'Choisissez l’unité adverse (dégâts = force)': 'Choose the enemy unit (damage = Might)', 'Choisissez l’unité à bannir et rejouer': 'Choose the unit to banish and replay',
  'Choisissez l’unité à déplacer': 'Choose the unit to move', 'Placez une unité sous le deck': 'Put a unit at the bottom of the deck', 'Détruisez une de vos unités': 'Kill one of your units',
  'Buffez une unité': 'Buff a unit', 'Choisissez une cible': 'Choose a target', 'Choisissez le champ de bataille': 'Choose the battlefield', 'Choisissez un champ de bataille': 'Choose a battlefield',
  'Prédiction': 'Predict', 'Choisissez une carte': 'Choose a card', 'Cliquez sur les cartes de votre main à défausser.': 'Click the cards in your hand to discard.', 'Cliquez sur l’unité à détruire.': 'Click the unit to kill.',
  'Cliquez sur l’unité alliée qui reçoit le buff (+1 force si elle n’en a pas déjà un).': 'Click the friendly unit that gets the buff (+1 Might if it has none yet).',
  'Cliquez sur la cible. Les unités ennemies sont marquées en rouge.': 'Click the target. Enemy units are marked in red.', 'Cliquez sur le champ de bataille visé.': 'Click the battlefield.',
  'Le dessus de votre deck. Cliquez sur les cartes à recycler sous le deck, les autres restent dessus.': 'The top of your deck. Click the cards to recycle to the bottom; the others stay on top.',
  'Non jouable (coût ou type)': 'Not playable (cost or type)', 'retirer Empowered': 'disempower', 'Ne rien prendre': 'Take nothing', 'Tout garder': 'Keep all', 'Valider': 'Confirm', 'Fermer': 'Close', 'Vide': 'Empty', 'Mélanger et fermer': 'Shuffle and close',
  'Ordre : du dessus vers le dessous. Glissez une carte vers le plateau ou clic droit pour la déplacer.': 'Order: top to bottom. Drag a card to the board or right-click it to move it.',
  'Glissez une carte vers le plateau ou clic droit pour la déplacer.': 'Drag a card to the board or right-click it to move it.',
  // pre-game
  'Choix des champs de bataille': 'Battlefield choice', 'Qui commence ?': 'Who goes first?', 'Mulligan': 'Mulligan', 'Choisissez votre champ de bataille': 'Choose your battlefield',
  'Parmi les champs de bataille de votre deck, choisissez celui qui sera en jeu.': 'Choose which of your deck’s battlefields will be in play.',
  'Choisissez pair ou impair : le dé est lancé aussitôt. Si le résultat correspond, vous commencez.': 'Choose even or odd: the die is rolled at once. If the result matches, you go first.',
  'Pair': 'Even', 'Impair': 'Odd', 'pair': 'even', 'impair': 'odd', 'En attente': 'Waiting', 'Lancer le dé': 'Roll the die', 'Commencer la partie': 'Start the game',
  '2 cartes maximum': '2 cards maximum', 'Garder ma main': 'Keep my hand', 'Vous commencez !': 'You go first!', 'À vous de jouer': 'Your turn',
  // context menus
  'Carte cachée': 'Hidden card', '✦ Jouer la carte cachée (gratuit)': '✦ Play the hidden card (free)', 'Cacher (payez 1 puissance)': 'Hide (pay 1 power)',
  'Ayez d’abord une unité sur un champ de bataille': 'First have a unit at a battlefield', 'Détacher l’équipement': 'Detach the gear', 'Aucune unité': 'No unit',
  'détruire cette carte': 'kill this card', 'Retirer le renfort (Empowered)': 'Remove Empowered', 'Utiliser le Gold (+1 puissance au choix)': 'Use the Gold (+1 power of any domain)',
  '✦ Lancer (sur la pile)': '✦ Cast (on the stack)', '✦ Jouer': '✦ Play', 'Contrer (vers la défausse)': 'Counter (to the trash)', 'Recycler la rune': 'Recycle the rune', 'Redresser': 'Ready',
  'Aucune unité ennemie': 'No enemy unit', 'Buff (+1 si aucun buff)': 'Buff (+1 if no buff)', 'Force +1 ce tour': '+1 Might this turn', 'Retirer l’étourdissement': 'Remove stun',
  'Déplacer vers': 'Move to', 'Dessous du deck de runes': 'Bottom of the rune deck', 'Dessus du deck': 'Top of the deck', 'Dessous du deck': 'Bottom of the deck', 'Bannir': 'Banish',
  'Retourner face cachée / visible': 'Turn face down / face up', 'Révéler à l’adversaire': 'Reveal to the opponent', 'Marqueurs': 'Counters', 'votre base': 'your base',
  'Chercher dans le deck': 'Search the deck', 'Voir les cartes': 'View cards', 'Piocher 1': 'Draw 1', 'Piocher 2': 'Draw 2', 'Piocher…': 'Draw…', 'Mélanger': 'Shuffle',
  'Regarder 1': 'Look at 1', 'Regarder…': 'Look at…', 'Canaliser 1': 'Channel 1', 'Canaliser 2': 'Channel 2', 'Combien de cartes ?': 'How many cards?',
  'Combien de cartes regarder ?': 'How many cards to look at?', 'Je contrôle': 'I control', 'L’adversaire contrôle': 'Opponent controls', 'Suppr': 'Del', 'Espace': 'Space',
  // end of game, sideboard, options
  'Match': 'Match', 'Partie': 'Game', 'Fin de la partie': 'Game over', 'Victoire !': 'Victory!', 'Défaite': 'Defeat', 'atteint': 'reaches', 'points': 'points', 'Vous': 'You',
  'Vous remportez le match !': 'You win the match!', 'Vous perdez le match.': 'You lose the match.', 'Voir le plateau': 'View the board', 'Menu principal': 'Main menu',
  'Partie suivante': 'Next game', 'Rejouer': 'Play again', 'Sideboard et partie suivante': 'Sideboard and next game', 'Sideboard et rejouer': 'Sideboard and play again',
  'Sideboard': 'Sideboard', 'Cliquez sur une carte pour la passer de l’autre côté. Le deck doit garder': 'Click a card to move it to the other side. The deck must keep',
  'cartes': 'cards', 'Deck d’origine': 'Original deck', 'Retour': 'Back', 'Partie terminée': 'Game over',
  'Langue': 'Language', 'Français': 'Français', 'English': 'English', 'Volume des animations': 'Animation volume', 'Volume du survol': 'Hover volume',
  'Sons des cartes, des tours, des points et des clics.': 'Card, turn, point and click sounds.', 'Petit son au passage de la souris sur les boutons.': 'Small sound when the mouse passes over buttons.',
  'Couper tous les sons': 'Mute all sounds', 'La page se recharge pour changer de langue.': 'The page reloads to change the language.',
  // engine errors
  'Affrontement en cours : seules les cartes [Action] ou [Reaction] se jouent.': 'Showdown in progress: only [Action] or [Reaction] cards can be played.',
  'Cacher coûte 1 puissance (n’importe quel domaine) : recyclez une rune.': 'Hiding costs 1 power (any domain): recycle a rune.', 'Carte introuvable dans la main': 'Card not found in hand',
  'Carte introuvable': 'Card not found', 'carte introuvable': 'card not found', 'Ce Gold est épuisé': 'This Gold is exhausted', 'Ce n’est pas votre carte': 'This is not your card',
  'Ce sort n’est pas le vôtre : laissez-le résoudre (ou répondez).': 'This spell is not yours: let it resolve (or respond).',
  'Cette capacité s’active pendant votre tour, hors affrontement.': 'This ability is used on your turn, outside showdowns.', 'Cette carte ne se joue pas ainsi': 'This card can’t be played this way',
  'Cette carte n’a pas de coût Flow': 'This card has no Flow cost', 'Champ de bataille inconnu': 'Unknown battlefield', 'Choisissez une autre unité': 'Choose another unit',
  'Choisissez une de vos unités': 'Choose one of your units', 'Cible invalide': 'Invalid target', 'C’est votre propre carte': 'This is your own card', 'Déjà choisi': 'Already chosen', 'Déjà fait': 'Already done',
  'Il faut contrôler ce champ de bataille (y avoir vos unités) pour y cacher une carte.': 'You must control this battlefield (have units there) to hide a card there.',
  'Il faut des unités des deux côtés': 'Units are needed on both sides', 'Il y a déjà une carte cachée sur ce champ de bataille.': 'There is already a hidden card at this battlefield.',
  'La partie n’a pas encore commencé': 'The game hasn’t started yet', 'La pile est vide': 'The stack is empty', 'Le tour a déjà commencé': 'The turn has already started',
  'Mulligan déjà fait': 'Mulligan already done', 'Mulligan limité à 2 cartes': 'Mulligan limited to 2 cards', 'On cache une carte pendant son tour.': 'Cards are hidden on your own turn.',
  'Pas d’affrontement en cours': 'No showdown in progress', 'Pas maintenant': 'Not now', 'Rien à annuler': 'Nothing to undo', 'Rien à résoudre': 'Nothing to resolve',
  'Résolvez d’abord la pile': 'Resolve the stack first', 'Résolvez d’abord la pile.': 'Resolve the stack first.', 'Seules les capacités [Reaction] répondent à la pile.': 'Only [Reaction] abilities respond to the stack.',
  'Un choix est déjà en attente.': 'A choice is already pending.', 'Une carte cachée se joue à partir du tour suivant.': 'A hidden card can be played from the next turn.',
  'Une carte est sur la pile : seules les cartes [Reaction] peuvent y répondre.': 'A card is on the stack: only [Reaction] cards can respond.',
  'Une unité jouée depuis une carte cachée arrive sur ce champ de bataille.': 'A unit played from a hidden card enters at that battlefield.', 'Votre deck est vide.': 'Your deck is empty.',
  'Choisissez un deck': 'Choose a deck', 'Deck invalide : échangez carte pour carte entre le deck et le sideboard.': 'Invalid deck: swap card for card between the deck and the sideboard.',
  'La partie a déjà commencé': 'The game has already started', 'La partie n’est pas terminée': 'The game is not over', 'Partie introuvable': 'Game not found', 'Tag inconnu': 'Unknown tag',
  // words inside log messages
  'automatique': 'automatic', 'épuisée': 'exhausted', 'épuisées': 'exhausted', 'détruit': 'killed', 'étourdi': 'stunned', 'redressé': 'readied',
};

// templates: {0}, {1}... stand for any text (names, numbers); the captured text is translated too when it is a known word
const EN_TPL = [
  // log (game.js)
  ['{0} reprend {1} (déjà marqué ce tour : pas de point).', '{0} retakes {1} (already scored this turn: no point).'],
  ['⚔ {0} conquiert {1}. Point final : il faut avoir marqué chaque champ de bataille ce tour, {2} pioche {3} carte à la place.', '⚔ {0} conquers {1}. Final point: every battlefield must have been scored this turn, {2} draws {3} card instead.'],
  ['⚔ {0} conquiert {1} (+1 point, total {2}).', '⚔ {0} conquers {1} (+1 point, total {2}).'],
  ['🏆 {0} atteint {1} points et gagne la partie !', '🏆 {0} reaches {1} points and wins the game!'],
  ['La carte cachée de {0} ({1}) est révélée et défaussée : champ de bataille perdu.', '{0}’s hidden card ({1}) is revealed and discarded: battlefield lost.'],
  ['☠ {0} est détruit.', '☠ {0} is killed.'], ['↳ {0} ({1}) : capacité déclenchée.', '↳ {0} ({1}): ability triggered.'],
  ['{0} reçoit un buff (+1 force).', '{0} gets a buff (+1 Might).'], ['{0} gagne {1} XP (Hunt, {2}).', '{0} gains {1} XP (Hunt, {2}).'],
  ['↳ {0} libre : prenez-en le contrôle à la main (⚑, +1 point).', '↳ {0} is free: take control of it by hand (⚑, +1 point).'],
  ['⚔ Affrontement sur {0} : {1} attaque. Chacun peut jouer des cartes [Action]/[Reaction], puis passer.', '⚔ Showdown at {0}: {1} attacks. Each player may play [Action]/[Reaction] cards, then pass.'],
  ['{0} ({1}) se résout.', '{0} ({1}) resolves.'], ['{0} pioche {1} ({2}).', '{0} draws {1} ({2}).'], ['{0} révèle sa main ({1}).', '{0} reveals their hand ({1}).'],
  ['{0} : {1} ne peut pas être contré ainsi.', '{0}: {1} can’t be countered this way.'], ['{0} est contré ({1}).', '{0} is countered ({1}).'],
  ['{0} : aucune cible valide.', '{0}: no valid target.'], ['{0} : sa cible n’est plus en jeu.', '{0}: its target is no longer in play.'],
  ['{0} choisit une cible ({1}).', '{0} chooses a target ({1}).'], ['{0} choisit un champ de bataille ({1}).', '{0} chooses a battlefield ({1}).'],
  ['{0} inflige {1} à {2} unité{3}.', '{0} deals {1} to {2} unit{3}.'], ['La légende de {0} est redressée ({1}).', '{0}’s legend is readied ({1}).'],
  ['{0} ajoute {1} à sa réserve ({2}).', '{0} adds {1} to their pool ({2}).'], ['{0} : les autres unités de {1} ici gagnent [Shield{2}] ce tour.', '{0}: {1}’s other units here gain [Shield{2}] this turn.'],
  ['Les unités de {0} sont {1} ({2}).', '{0}’s units are {1} ({2}).'], ['Chaque joueur défausse sa main et pioche {0} ({1}).', 'Each player discards their hand and draws {0} ({1}).'],
  ['{0}{1} gagnent {2}{3} force ce tour ({4}).', '{0}{1} get {2}{3} Might this turn ({4}).'], ['{0} canalise {1} rune{2}{3} ({4}).', '{0} channels {1} rune{2}{3} ({4}).'],
  ['{0} gagne {1} XP ({2}).', '{0} gains {1} XP ({2}).'], ['{0} brûle {1} carte{2} du dessus de son deck ({3}).', '{0} burns {1} card{2} from the top of their deck ({3}).'],
  ['{0} regarde les {1} cartes du dessus de son deck ({2}).', '{0} looks at the top {1} cards of their deck ({2}).'], ['{0} regarde la carte du dessus de son deck ({1}).', '{0} looks at the top card of their deck ({1}).'],
  ['{0} regarde les {1} cartes du dessus de son deck.', '{0} looks at the top {1} cards of their deck.'], ['{0} regarde la carte du dessus de son deck.', '{0} looks at the top card of their deck.'],
  ['{0} choisit une unité à buffer ({1}).', '{0} chooses a unit to buff ({1}).'], ['{0} défausse toute sa main ({1}).', '{0} discards their whole hand ({1}).'],
  ['{0} doit défausser {1} carte{2} ({3}).', '{0} must discard {1} card{2} ({3}).'], ['{0} doit détruire une de ses unités ({1}).', '{0} must kill one of their units ({1}).'],
  ['{0} paie {1} puissance (Deflect de {2}).', '{0} pays {1} power ({2}’s Deflect).'], ['{0} subit {1} dégât{2}{3}.', '{0} takes {1} damage{3}.'],
  ['{0} est étourdi{1}.', '{0} is stunned{1}.'], ['{0} gagne {1}{2} force ce tour{3}.', '{0} gets {1}{2} Might this turn{3}.'], ['{0} est redressé{1}.', '{0} is readied{1}.'],
  ['{0} gagne [Assault {1}] ce tour{2}.', '{0} gains [Assault {1}] this turn{2}.'], ['{0} gagne [Shield {1}]{2} ce tour{3}.', '{0} gains [Shield {1}]{2} this turn{3}.'],
  ['La force de {0} est doublée ce tour (+{1}){2}.', '{0}’s Might is doubled this turn (+{1}){2}.'], ['{0} subit {1} dégâts{2}.', '{0} takes {1} damage{2}.'],
  ['{0} est placé sous le deck de son propriétaire{1}.', '{0} is put at the bottom of its owner’s deck{1}.'], ['{0} choisit le champ de bataille de {1} ({2}).', '{0} chooses the battlefield for {1} ({2}).'],
  ['{0} est attaché à {1}{2}.', '{0} is attached to {1}{2}.'], ['{0} est rappelé dans sa base{1}.', '{0} is recalled to its base{1}.'],
  ['{0} retourne dans la main de son propriétaire{1}.', '{0} returns to its owner’s hand{1}.'], ['⚔ {0} ({1}) et {2} ({3}) s’infligent des dégâts égaux à leur force.', '⚔ {0} ({1}) and {2} ({3}) deal damage equal to their Might to each other.'],
  ['{0} inflige {1} à toutes les unités ennemies sur {2}.', '{0} deals {1} to all enemy units at {2}.'],
  ['🔥 Burn Out : le deck de {0} est vide. Sa défausse est mélangée dans son deck et {1} gagne 1 point ({2}).', '🔥 Burn Out: {0}’s deck is empty. Their trash is shuffled into their deck and {1} gains 1 point ({2}).'],
  ['Choix des champs de bataille : chaque joueur en choisit un parmi les 3 de son deck.', 'Battlefield choice: each player picks one of the 3 in their deck.'],
  ['Qui commence ? {0} choisit pair ou impair.', 'Who goes first? {0} chooses even or odd.'],
  ['— Tour {0} · {1} : à vous de redresser, {2}canaliser {3} runes et piocher 1 carte.', '— Turn {0} · {1}: ready, {2}channel {3} runes and draw 1 card.'],
  ['↳ {0} est Temporary : à détruire à la main.', '↳ {0} is Temporary: kill it by hand.'], ['— Tour {0} · {1} : réveil, {2}canalise {3}, {4}.', '— Turn {0} · {1}: awaken, {2}channel {3}, {4}.'],
  ['{0} a choisi son champ de bataille.', '{0} has chosen their battlefield.'], ['{0} choisit {1} ; {2} a donc {3}.', '{0} chooses {1}; {2} gets {3}.'],
  ['🎲 {0} lance le dé : {1} ({2}). {3} commence !', '🎲 {0} rolls the die: {1} ({2}). {3} goes first!'],
  ['Mulligan : chaque joueur peut renvoyer jusqu’à 2 cartes de sa main de départ.', 'Mulligan: each player may send back up to 2 cards from their opening hand.'],
  ['Tour 1 : {0}. Bonne partie !', 'Turn 1: {0}. Have a good game!'], ['{0} a quitté la partie.', '{0} left the game.'], ['{0} passe en mode {1}.', '{0} switches to {1} mode.'],
  ['{0} annule la dernière action.', '{0} undoes the last action.'], ['Le jeton {0} quitte le jeu.', 'The {0} token leaves play.'], ['{0} déplace {1} vers {2}{3}.', '{0} moves {1} to {2}{3}.'],
  ['✦ {0} lance {1}. Sur la pile : l’adversaire peut réagir.', '✦ {0} casts {1}. On the stack: the opponent may react.'], ['✦ {0} lance {1}. En réponse sur la pile.', '✦ {0} casts {1}. In response, on the stack.'],
  ['✦ {0} joue {1}.', '✦ {0} plays {1}.'], ['{0} ne réagit pas à {1}.', '{0} doesn’t react to {1}.'], ['{0} passe.', '{0} passes.'], ['{0} contrôle {1}.', '{0} controls {1}.'],
  ['{0} cache une carte face cachée sur {1} (jouable gratuitement dès le tour suivant).', '{0} hides a card face down at {1} (free to play from the next turn).'],
  ['{0} équipe {1} de {2} (+{3} force).', '{0} equips {1} with {2} (+{3} Might).'], ['⚡ {0} active {1} : {2}', '⚡ {0} activates {1}: {2}'], ['{0} détache {1}.', '{0} detaches {1}.'],
  ['{0} n’est plus Empowered.', '{0} is no longer Empowered.'], ['{0} rend {1} Empowered.', '{0} makes {1} Empowered.'],
  ['{0} utilise un Gold : +1 puissance (n’importe quel domaine) en réserve.', '{0} uses a Gold: +1 power (any domain) in pool.'], ['{0} ne choisit pas de cible ({1}).', '{0} chooses no target ({1}).'],
  ['{0} défausse {1} ({2}).', '{0} discards {1} ({2}).'], ['{0} inflige {1} à {2}.', '{0} deals {1} to {2}.'], ['{0} gagne +{1} force ce tour.', '{0} gets +{1} Might this turn.'],
  ['{0} désarme {1} (−{2} force ce tour).', '{0} disarms {1} (−{2} Might this turn).'], ['⚔ Combat sur {0} : {1} ({2}) contre {3} ({4}).', '⚔ Combat at {0}: {1} ({2}) against {3} ({4}).'],
  ['Les attaquants survivants retournent à la base.', 'The surviving attackers return to base.'], ['{0} retourne {1}.', '{0} turns over {1}.'], ['{0} révèle {1} depuis sa main.', '{0} reveals {1} from their hand.'],
  ['{0} retire tous les dégâts.', '{0} removes all damage.'], ['{0} canalise {1} rune{2}.', '{0} channels {1} rune{2}.'], ['{0} recycle {1}{2}.', '{0} recycles {1}{2}.'], ['{0} mélange son {1}.', '{0} shuffles their {1}.'],
  ['{0} redresse toutes ses cartes.', '{0} readies all their cards.'], ['Fin du tour de {0}. Tour {1} : {2}.', 'End of {0}’s turn. Turn {1}: {2}.'], ['🎲 {0} lance un dé {1} : {2}.', '🎲 {0} rolls a d{1}: {2}.'],
  ['Score de victoire : {0}.', 'Victory score: {0}.'], ['{0} recycle {1} carte{2} sous son deck ({3}).', '{0} recycles {1} card{2} to the bottom of their deck ({3}).'],
  ['{0} garde la carte du dessus ({1}).', '{0} keeps the top card ({1}).'], ['{0} est banni puis rejoué sur {1} ({2}).', '{0} is banished then played again at {1} ({2}).'],
  ['{0} se déplace vers {1} ({2}).', '{0} moves to {1} ({2}).'], ['{0} se déplace vers {1} et se redresse ({2}).', '{0} moves to {1} and readies ({2}).'],
  ['{0} choisit {1}.', '{0} chooses {1}.'], ['{0} garde sa main.', '{0} keeps their hand.'], ['{0} : {1} point{2}{3}.', '{0}: {1} point{2}{3}.'],
  ['{0} : {1} sur {2} ce tour.', '{0}: {1} at {2} this turn.'], ['{0} crée {1} {2}{3}{4}.', '{0} creates {1} {2}{3}{4}.'],
  // interface
  ['↳ {0} ({1}, {2}) : « {3} » À appliquer à la main.', '↳ {0} ({1}, {2}): “{3}” Apply it by hand.'], ['↳ {0} ({1}, {2}) : effet du champ de bataille.', '↳ {0} ({1}, {2}): battlefield ability.'],
  ['{0} choisit d’utiliser ou non {1}.', '{0} chooses whether to use {1}.'], ['{0} utilise {1}.', '{0} uses {1}.'], ['{0} n’utilise pas {1}.', '{0} doesn’t use {1}.'],
  ['{0} : {1} ne peut pas payer ({2}).', '{0}: {1} can’t pay ({2}).'], ['{0} recycle une rune ({1}).', '{0} recycles a rune ({1}).'],
  ['{0} redressera {1} runes à la fin du tour ({2}).', '{0} will ready {1} runes at the end of the turn ({2}).'], ['{0} marque 1 point ({1}, total {2}).', '{0} scores 1 point ({1}, total {2}).'],
  ['{0} reprend son champion choisi depuis sa défausse ({1}).', '{0} returns their chosen champion from the trash ({1}).'], ['🏆 {0} a {1} unités sur {2} et gagne la partie !', '🏆 {0} has {1} units at {2} and wins the game!'],
  ['{0} révèle {1} : un sort, il va dans sa main ({2}).', '{0} reveals {1}: a spell, it goes to their hand ({2}).'], ['{0} révèle {1} et le recycle ({2}).', '{0} reveals {1} and recycles it ({2}).'],
  ['{0} inflige {1} à chaque unité ici ({2}).', '{0} deals {1} to each unit here ({2}).'], ['{0} dépense le buff de {1} ({2}).', '{0} spends {1}’s buff ({2}).'],
  ['{0} redresse {1} rune{2} (Targon\'s Peak).', '{0} readies {1} rune{2} (Targon\'s Peak).'], ['Aspirant\'s Climb : il faut {0} points pour gagner.', 'Aspirant\'s Climb: {0} points are needed to win.'],
  ['{0} ajoute le champ de bataille Baron Pit et y entre.', '{0} adds the Baron Pit battlefield and enters there.'], ['Pas assez de runes ({0}).', 'Not enough runes ({0}).'],
  ['Tour de {0}', '{0}’s turn'], ['Tour {0}', 'Turn {0}'], ['Main · {0}', 'Hand · {0}'], ['Base · {0}', 'Base · {0}'], ['{0} réfléchit', '{0} is thinking'], ['({0})', '({0})'],
  ['{0} joue', '{0} plays'], ['Défausse · {0}', 'Trash · {0}'], ['Bannis · {0}', 'Banishment · {0}'], ['Deck · {0}', 'Deck · {0}'], ['Victoire de {0} !', '{0} wins!'], ['Votre choix est fait. {0} choisit le sien…', 'Your choice is made. {0} is choosing…'],
  ['Vous avez « {0} », {1} a « {2} ». Lancez le dé !', 'You have “{0}”, {1} has “{2}”. Roll the die!'], ['{0} a choisi « {1} », vous avez « {2} ».', '{0} chose “{1}”, you have “{2}”.'],
  ['{0} lance le dé…', '{0} rolls the die…'], ['{0} lance le dé', '{0} rolls the die'], ['{0} commence !', '{0} goes first!'],
  ['Les cartes repiochées sont en surbrillance. {0} commence.', 'The redrawn cards are highlighted. {0} goes first.'],
  ['{0} commence. Cliquez jusqu’à 2 cartes à renvoyer sous votre deck : vous en repiochez autant.', '{0} goes first. Click up to 2 cards to send to the bottom of your deck: you draw as many.'],
  ['Infligez {0} (et {1} aux autres ennemis là-bas)', 'Deal {0} (and {1} to the other enemies there)'], ['{0} dégâts aux ennemis d’un champ de bataille', '{0} damage to the enemies at a battlefield'],
  ['Infligez {0} dégâts', 'Deal {0} damage'], ['Infligez {0} dégât', 'Deal {0} damage'], ['Défausse{0} {1} carte{2}', 'Discard {1} card{2}'], ['Défaussez {0} carte{1}', 'Discard {0} card{1}'],
  ['{0} réfléchit à une réponse', '{0} is thinking about a response'], ['{0} a la main', '{0} has priority'], ['{0} cartes en cache · cliquer pour mettre à jour', '{0} cards cached · click to update'],
  ['Champs de bataille {0}/3', 'Battlefields {0}/3'], ['Puissance {0}', '{0} power'], ['Recycler {0} carte{1}', 'Recycle {0} card{1}'], ['Créer un jeton · {0}', 'Create a token · {0}'],
  ['✦ Jouer sur {0}', '✦ Play at {0}'], ['✦ Jouer avec Repeat (payez {0} en plus)', '✦ Play with Repeat (pay {0} more)'], ['✦ Jouer depuis la défausse (Flow : {0})', '✦ Play from the trash (Flow: {0})'],
  ['Équiper ({0})', 'Equip ({0})'], ['Renforcer (Empower {0})', 'Empower ({0})'], ['🎲 Deck tiré au sort — {0}', '🎲 Random deck — {0}'], ['Fin du tour de {0}', 'End of {0}’s turn'],
];

const EN_RX = EN_TPL.map(([fr, en]) => {
  const parts = fr.split(/\{\d+\}/), keys = [...fr.matchAll(/\{(\d+)\}/g)].map(m => +m[1]);
  const rx = new RegExp('^' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$');
  return { rx, en, keys, lit: parts.join('').length };
}).sort((a, b) => b.lit - a.lit);
// pieces of French found inside captured text (costs, "pioche 1"...)
const FRAG = [[/\bpioche (\d+)/g, 'draw $1'], [/(\d+) énergie/g, '$1 energy'], [/(\d+) puissance/g, '$1 power'], [/, accéléré/g, ', accelerated'], [/, avec Repeat/g, ', with Repeat'],
  [/ \(depuis sa carte cachée\)/g, ' (from its hidden card)'], [/ depuis sa défausse \(Flow\)/g, ' from the trash (Flow)'], [/ ce tour/g, ' this turn'], [/ \(dessous\)/g, ' (bottom)'],
  [/\bsa base\b/g, 'their base'], [/\bsa main\b/g, 'their hand'], [/\bsa défausse\b/g, 'their trash'], [/\bun champ de bataille\b/g, 'a battlefield'], [/\ble champ de bataille\b/g, 'the battlefield'],
  [/\bjetons?\b/g, 'token'], [/\bdans sa base\b/g, 'in their base'], [/\bsur le champ de bataille\b/g, 'at the battlefield'], [/\bépuisées?\b/g, 'exhausted']];
const trWord = w => (EN[w] != null ? EN[w] : FRAG.reduce((a, [rx, to]) => a.replace(rx, to), w));
function trStr(s) {
  if (EN[s] != null) return EN[s];
  for (const t of EN_RX) {
    const m = t.rx.exec(s); if (!m) continue;
    const vals = {}; t.keys.forEach((k, i) => (vals[k] = trWord(m[i + 1])));
    return t.en.replace(/\{(\d+)\}/g, (_, k) => vals[k] != null ? vals[k] : '');
  }
  return s;
}
// T(): French text of the interface, translated when English is chosen
function T(s) { return LANG === 'en' ? trStr(s) : s; }

if (LANG === 'en') {
  document.documentElement.lang = 'en';
  const skip = n => { const p = n.nodeType === 1 ? n : n.parentElement; return !p || !!p.closest('.card .in, .zoom, script, style, textarea, .chat'); };
  const trText = n => { const v = n.nodeValue, k = v.trim(); if (!k || !/[A-Za-zÀ-ÿ]/.test(k) || skip(n)) return; const t = trStr(k); if (t !== k) n.nodeValue = v.replace(k, t); };
  const trAttrs = el => { for (const a of ['title', 'placeholder']) { const v = el.getAttribute(a); if (v) { const t = trStr(v); if (t !== v) el.setAttribute(a, t); } } };
  const trTree = root => {
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType !== 1 || skip(root)) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) trText(n); else if (!skip(n)) trAttrs(n); }
  };
  const start = () => {
    trTree(document.body);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') { if (!skip(m.target)) trAttrs(m.target); }
        else m.addedNodes.forEach(trTree);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // browser dialogs (confirm / prompt) show the translated question
  const c0 = window.confirm.bind(window), p0 = window.prompt.bind(window);
  window.confirm = q => c0(trStr(q)); window.prompt = (q, d) => p0(trStr(q), d);
}
