# CM Team Plan — le trio d'une prépa Champions Meeting

## Objet

Auto Prep raisonne aujourd'hui **une seule uma** (le rôle d'As). Une vraie prépa
CM, c'est **un trio coordonné avec une stratégie d'équipe**. Ce chantier ajoute
la **couche équipe** au-dessus des briques par-uma déjà livrées (fit, deck,
skills, stats, parents, meta) : sélection d'un trio à rôles + stratégie globale,
puis un sous-plan par uma.

## Fonctionnement d'une CM (recherche 13/07/2026, sourcé)

Sources: GameTora (events/champions-meeting), Game8 (541155),
umareference.com (pvp-champions-meeting), uma.guide (beginners-cm).

- **3v3v3** : chaque course = 3 équipes de 3 = **9 umas**, mêmes conditions, en
  simultané. **Seule la 1re place de ton équipe compte** (ton meilleur finisher
  marque la victoire ; les deux autres équipes prennent une défaite).
- **Structure** : 3 manches. Manches 1-2 = qualifs (2 jours, jusqu'à 4
  tentatives/jour, **chaque tentative = 5 courses** vs adversaires aléatoires,
  **meilleure tentative comptée** ; 3 victoires+ → Groupe A). Finale = 1 course,
  sans adversaires en temps réel.

## Le trio à 3 rôles (le coeur du chantier)

Comme **seul le 1er compte**, on met le paquet sur UN as, et les deux autres
existent pour l'aider :

1. **Ace / Carry** — doit *gagner*. = `buildAutoPrepPlan` actuel, tel quel
   (meilleur fit d'aptitude, build optimal). Le meilleur fit du roster va ici.
2. **Debuffer** — job = *saboter les adversaires*, pas gagner. Build **radicalement
   différent** : **Wit élevé (800→1200)** pour activer ses skills de façon fiable,
   **stats de course quasi ignorées** (sa position finale n'a aucune importance,
   il faut juste survivre la course), **skills de debuff priorisés** — vitesse en
   Sprint/Mile, stamina en Medium/Long.
3. **Pacer / 2e attaquant** — utilitaire : meneur sacrificiel (peu de stamina,
   mène pour déclencher/contrôler le rythme) ou 2e finisher de secours.

Mécaniques d'équipe transverses :
- **Diversité de style** (réel) : « un meneur seul court moins bien » ; « zéro
  meneur → un poursuivant adverse prend un gros buff ». On répartit les styles et
  on contrôle le front. Contrainte au niveau **équipe**, pas par uma.
  (styles: runner=Front Runner, leader=Pace Chaser, betweener=Late Surger,
  chaser=End Closer.)
- **3 umas distinctes** entraînées, une par slot.

## Décisions actées (utilisateur, 13/07/2026)

- **Debuffer = build complet** : cible de stats Wit-lourde + skills de debuff
  priorisés par distance + parents adaptés.
- **Soutiens = roster réel d'abord** : piocher parmi les umas entraînées
  possédées qui ont déjà un kit adapté (skills de debuff pour le debuffer, style
  meneur pour le pacer), fit d'aptitude secondaire.
- **Périmètre v1 = moteur d'abord** : couche équipe pure + sous-planificateurs,
  testée, zéro UI (comme Auto Prep Phase 1). UI ensuite.

## Limite assumée (pas de fausse précision)

Aucune simulation d'adversaire/position (Tier 3, hors périmètre — assumé partout
dans le projet). Le planificateur d'équipe reste **déterministe et explicable** :
il recommande une **composition saine** (rôles, styles, builds par rôle) et non
une prédiction d'issue de course sur 9 umas.

Contrainte de données constatée : les effets de debuff (skill effect types
8/13/21) n'exposent que `type`+`value`, **pas la stat ciblée** — on ne peut pas
séparer proprement debuff-vitesse vs debuff-stamina par la donnée. Donc le
recommandeur debuffer **priorise les skills de debuff** et donne la consigne
par distance en **texte étiqueté**, sans auto-filtrer par stat (heuristique
honnête, comme le reste).

## Phase 1 — moteur — LIVREE (13/07/2026)

Tout dans `build_recommender.js` (pur, testé), zéro UI. Suite verte (234 JS).
API livrée : `TEAM_ROLES`, `recommendDebufferSkills` (+ `debufferDistanceGuidance`),
`roleStatTarget`, `scoreCharacterForRole`, `teamStyleSpread`,
`buildAutoPrepTeamPlan`. L'As reste `buildAutoPrepPlan` (compat intacte).

Validé par un spike sur données réelles (cible Gemini Cup Long Turf 3200m) :
As = Special Week (leader, fit 1) ; **Debuffer = Matikanefukukitaru** (betweener,
Wit 1200, skills de debuff **détectés dans son kit** : Illusionist / Smoke Screen
/ Hesitant Front Runners, consigne « stamina debuffs ») ; Pacer = Seiun Sky
(runner). Styles ["leader","betweener","runner"] → spread complet, meneur présent.
Choix cohérents avec la meta réelle (Matikanefukukitaru est un debuffer connu,
Seiun Sky un meneur connu).

### API (détail)

Dans `build_recommender.js` (réutilise tout l'existant), ou un module dédié si
ça grossit trop. API visée :

- **Rôles** : constantes `TEAM_ROLES = ["ace", "debuffer", "pacer"]`.
- **1a. Debuffer skills** : `recommendDebufferSkills(pool, targetProfile)` —
  inverse l'exclusion des debuffs de `recommendSkillsForBuild` : debuffs
  priorisés, + `guidance` par distance (vitesse Sprint/Mile, stamina
  Medium/Long) en texte. Sortie required/optional + reasons.
- **1b. Cibles de stats par rôle** : `roleStatTarget(targetProfile, role)` —
  ace = `proposeTargetStats` ; debuffer = Wit-lourd (≥1200) + stamina de survie,
  reste ignoré ; pacer = variante meneur (vitesse + peu de stamina). Étiquetées
  heuristiques.
- **1c. Score de rôle** : `scoreCharacterForRole(charItem, targetProfile, role)` —
  ace = fit d'aptitude exact (existant) ; debuffer = aptitude Wit/survie + kit de
  debuff présent dans son propre pool de skills ; pacer = aptitude style meneur.
  Sert à piocher « la meilleure uma possédée pour ce rôle » (roster d'abord).
- **1d. Diversité de style** : `assignTeamStyles(aceStyle, candidates)` — l'as
  prend son style optimal ; soutiens prennent des styles complémentaires
  (couverture + contrôle du front). Documenté.
- **1e. Agrégateur équipe** : `buildAutoPrepTeamPlan(target, rosterData)` — 3
  umas **distinctes** (as = meilleur fit ; debuffer/pacer = meilleur rôle parmi
  le reste), diversité de style imposée, rend `{ ace: plan, debuffer: rolePlan,
  pacer: rolePlan, strategy: { styleSpread, reasons[] }, reasons[] }`. `weights?`
  (meta) branché partout comme en Auto Prep.

Tests : chaque fonction en node:test avec fixtures ; les tests existants de
`build_recommender`/`buildAutoPrepPlan` continuent de passer (compat — l'As
reste `buildAutoPrepPlan`).

## Phase 2 — UI équipe — LIVREE (13/07/2026)

`#/prep` rend désormais le **trio** au lieu d'une seule uma. Pont
`catalog.buildAutoPrepTeamPlanForDetail` (partage l'assemblage `rosterData`
avec le pont mono-uma). `renderPrepPage` affiche un **bandeau stratégie**
(badge de spread + why) avec **3 chips de rôle servant d'onglets** :
- **As** = les sections par-uma complètes réutilisées (deck, skills, scenario,
  parents, readouts, runs, badges meta, swaps, alternatives, save-as-draft —
  tout intact).
- **Debuffer / Pacer** = panneaux de rôle compacts (cible de stats du rôle +
  skills du rôle + guidance + tagline).
L'onglet actif se réinitialise au changement de cible. Vérifié en navigateur sur
p_001 : As Oguri Cap (tiebreaker meta), Debuffer Air Groove (Late Surger, Wit
1200, guidance stamina-debuff), Pacer Silence Suzuka (Front Runner) ; spread
"Pace Chaser / Late Surger / Front Runner" ; onglets OK, interactions de l'As
préservées, zéro erreur console.

Chantier CM Team : **Phases 1-2 livrées.** Suites possibles : seed d'éditeur par
rôle (debuffer/pacer), deck/parents par rôle, meta des rôles (debuffers meta).

## Plus tard

- Séparation fine speed/stamina debuff si une meilleure source d'effets arrive.
- Pondération meta des rôles (debuffers meta d'uma.moe) via les `weights?`.
