# Auto Prep Plan — la preparation CM sans effort

## Objet

Construire le mode par defaut de preparation CM: **l'utilisateur donne la
cible, l'app fait tout le reste** et rend un plan complet, justifie et
actionnable — l'equivalent local et deterministe d'une session ChatGPT
("je veux preparer telle CM, quelle uma de mon roster, quel deck, quel
scenario ?"), mais base sur le roster reel et des formules verifiees au lieu
d'un LLM qui hallucine.

Le contexte qui rend ce chantier possible maintenant: le roster reel est
dans l'app (167 supports avec niveaux/LB reels, ~45 umas — import par
screenshots livre), le moteur deterministe existe (fit d'aptitude exact,
HP/seuils, projection du last spurt), l'auto-build v1 aussi
(`build_recommender.js`), et `run_results` ferme la boucle plan/reel.

## Decisions actees

- **Parents = specification, pas selection** (decision utilisateur, motivee
  par le mecanisme d'emprunt: un parent sur deux vient de la liste d'amis au
  moment du setup, invisible pour l'app). Le moteur produit "Parent 1:
  STAMINA, LONG / Parent 2: SPEED, LONG" + sparks blancs prioritaires — le
  pense-bete qu'on a en tete devant l'ecran d'emprunt. L'import de
  l'inventaire veterans (faisable, voir la fin de ce doc) est un chantier
  separe et ulterieur.
- **Meta/Insights est une phase ulterieure, pas un prerequis.** Le plan v1
  est "solide par formule + valeurs reelles possedees"; la meta (uma.moe)
  viendra le ponderer ensuite. Chaque scoreur expose des ce chantier un
  point d'injection de poids optionnels pour ne rien refactorer a ce
  moment-la.
- **Explicabilite obligatoire**: chaque recommandation porte ses raisons
  (`reasons[]`, affichees dans l'UI). Pas de score opaque — c'est la
  philosophie du projet (logique explicable) et ce qui differencie de
  ChatGPT.
- **Pas de fausse precision**: les heuristiques restent etiquetees comme
  telles (comme aujourd'hui), et le scoring de zone de skill n'est active
  que quand la cible resout UNE piste (meme garde-fou que les panneaux
  Feasibility/Last Spurt).

## Ce qui existe deja (a reutiliser, pas a reconstruire)

- `build_recommender.js` (pur, teste): `targetProfileFromCmDetail`,
  `rankOwnedCharactersForTarget` (fit d'aptitude exact),
  `proposeTargetStats`, `recommendSupportDeck` (heuristique rarete+LB — LE
  point faible a upgrader), `recommendSkillsForBuild` (categories d'effet),
  `recommendBuildForTarget` (agregation partielle)
- `build_scoring.js` (pur, teste): fit exact, HP, seuils stamina/Guts, %
  activation Wiz, projection last spurt, `findTrackZoneAtDistance`
- `visualizer.js`: `parseConditionString`, `resolveStaticZones` — la brique
  "zones d'activation statiques sur une piste" pour le bonus course-aware
- projections serveur roster-view supports: `effective_effects` avec
  `current_value` **au niveau reel de la carte** (base
  `db-files/support_card_level`) — la donnee qui permet de scorer les decks
  sur la valeur reelle au lieu du proxy rarete+LB
- `cm_targets`: `start_ts`/`end_ts` (choix par defaut de la cible),
  `race_profile`, `related_racetracks`
- seed de draft en un clic: `state.pendingBuildSeed` +
  `startSeededBuildDraft` (l'editeur existant reste l'outil de raffinage)
- `run_results`: les runs passes par cible, pour la boucle "la derniere fois"

## La cible UX

Entree: le CTA principal de la home ("Prepare a Champions Meeting") mene a
**Auto Prep**. Une seule decision demandee: **la cible** (pre-selectionnee
sur la CM courante/a venir via `end_ts`; dropdown sinon). Un bouton.

Sortie: **une page de plan** unique, lisible de haut en bas comme une
reponse de chat, chaque section avec sa justification depliable:

1. **Uma retenue** + 2-3 alternatives cliquables (re-genere le plan) —
   raisons: grades exacts vs la cible, verdict du fit
2. **Style de course** — raison: meilleur coefficient de style
3. **Stats cibles** — raisons: repere stamina, seuil Guts, marge CM
   (heuristique etiquetee, comme aujourd'hui)
4. **Deck de 6 supports** (les cartes reelles, vignettes) — raisons PAR
   CARTE: valeurs effectives au niveau reel ("Friendship 25% @lv45",
   "Race bonus 5%..."), mix de types justifie par la distance; bouton de
   swap par slot (alternatives classees)
5. **Skills** required/optional — raisons: categorie d'effet, source
   (kit du perso / hints du deck), et si piste unique: zones d'activation
   presentes sur la piste
6. **Scenario suggere** — v1: table curee honnete (voir phase 1), etiquette
   "curated" en attendant la meta
7. **Spec parents** (format utilisateur): "Parent 1: STAMINA, LONG 3* /
   Parent 2: SPEED, LONG 3*; blancs prioritaires: [facteur course cible],
   [skills du build]" — derivee des ecarts d'aptitude et de la stat tendue
8. **Readouts deterministes**: Feasibility + Last Spurt (panneaux existants)
9. **Runs passes sur cette cible** (si presents): plan vs reel de la
   derniere fois
10. Actions: **Save as build draft** (seed de l'editeur existant),
    Regenerate, swaps inline

Zero champ obligatoire au-dela de la cible. Tout est editable ensuite dans
l'editeur de build classique (qui reste le mode "expert").

## Phases d'implementation

### Phase 1 — moteur (modules purs + tests, zero UI)

**1a. Deck sur valeurs reelles** (le plus gros gain qualite):
`scoreSupportForTarget(summary, targetProfile, weights?)` consomme les
`effective_effects` de la projection roster-view (valeur au niveau reel).
Modele de poids **transparent et documente** par familles d'effets
(friendship/training/specialty/bond/race bonus/hint...), module par la
distance/le profil de la cible; sortie `{score, reasons[]}`. Le mix de
types par distance (existant) devient une contrainte de composition, plus
le critere principal. `weights?` = point d'injection meta futur.
Remplace `scoreSupportSummary` dans `recommendSupportDeck` (signature
etendue, heuristique rarete+LB conservee en fallback quand une carte n'a
pas de projection).

**1b. Spec parents**: `recommendParentSpec(targetProfile, charItem,
buildSkills)` (pur) — rose = aptitudes de la cible ou le grade du perso est
< A (prioritee par le coefficient), bleu = stat la plus contrainte du plan
(seuils du Feasibility), blancs = facteurs de la course cible
(`g1_factors`/`related_races`) + skills du draft. Sortie: 2 specs de parent
+ liste de blancs prioritaires + `reasons[]`.

**1c. Scenario v1**: table curee `SCENARIO_NOTES` (par scenario: type de
bonus — courses vs entrainement —, caps notables, verdict par type de
cible), etiquetee "curated". `recommendScenario(targetProfile)` la
consomme. La meta remplacera/pondera plus tard. A defaut de certitude sur
un scenario, le dire ("no strong signal — pick your most practiced").

**1d. Skills course-aware (gated)**: quand `cm_target` resout UNE
racetrack, bonus de score pour les skills dont `resolveStaticZones` trouve
des zones sur cette piste (reutilisation directe du visualizer); sinon
comportement actuel inchange. Raison affichee: "activates on 2 zones of
this track".

**1e. Agregateur**: `buildAutoPrepPlan(target, rosterData)` orchestre tout
(candidats -> pour l'uma retenue: style/stats/deck/skills/scenario/spec
parents) et rend UN objet plan serialisable avec `reasons[]` partout +
`alternatives`. C'est l'API unique que l'UI consomme, et l'objet qu'on
peut seeder dans l'editeur.

Tests: chaque fonction en node:test avec fixtures (dont un cas complet
de plan sur des donnees reelles anonymisees); les tests existants de
`build_recommender` continuent de passer (compat).

### Phase 2 — UI Auto Prep

- Route `#/prep` (nouvelle page gate-like, pattern home/admin), section
  sidebar "CM Prep" pointant dessus; le CTA de la home y mene
- Ecran 1 (leger): cible pre-selectionnee (CM courante/prochaine par
  `end_ts`, sinon la plus recente) + bouton "Prepare"
- Ecran 2: la page de plan (structure UX ci-dessus), sections depliables
  "why", swaps (uma alternative, slot de deck), Save as draft (seed
  existant), Regenerate
- Perf: generation du plan 100% client sur donnees deja chargees (roster,
  projections, reference) — aucune latence attendue; memoisation par cible
- Verification navigateur sur le roster reel de bout en bout

### Phase 3 — boucle reelle

- Section "runs passes" sur la page de plan (filtre `run_results` par
  `target_id` — donnee deja stockee)
- Apres application d'un run: lien retour vers Auto Prep pour comparer
- Petit chantier, grosse valeur de confiance ("la derniere fois: plan 1600
  SPD -> obtenu 1580, 2e place")

### Phase 4 — Meta/Insights (chantier separe, deja cadre)

Sequence inchangee: spike uma.moe (couverture Global, mapping IDs — meme
methode empirique que les icones) -> go/no-go -> snapshots locaux dates ->
injection dans les `weights?` prevus en phase 1 (tier de l'uma, valeur meta
des cartes, scenario meta) + badge "meta" dans les raisons affichees.
Cadrage detaille: `EXTERNAL_SOURCES_PLAN.md` (brique Meta/Insights).

### Plus tard (hors perimetre, notes)

- Import de l'inventaire veterans (grille "Veteran Roster": sparks
  bleu/rose/vert + rang lisibles en masse, meme gabarit technique que
  l'import umas — les captures de l'utilisateur le confirment) -> upgrade
  de la spec parents en "tes parents qui collent + emprunte le complement".
  Les blancs/grands-parents restent manuels (fiches detail couteuses,
  faible valeur decisionnelle).
- Palier 3 (simulation multi-agents): horizon, pas necessaire a un automode
  credible.

## Risques et garde-fous

- **Poids du modele de valeur deck**: choisis a la main -> les documenter
  dans le module, les afficher dans les raisons, et les confronter aux
  premiers usages reels (et plus tard a la meta). Pas de pretention
  d'optimum.
- **Table scenarios curee**: source de verite faible avouee (etiquette
  "curated", remplacee par la meta en phase 4).
- **Cibles CM anciennes** (le dataset commence en 2021): le choix par
  defaut doit gerer "aucune CM future" (prendre la derniere passee +
  laisser choisir).
- **Compat**: `recommendBuildForTarget` et la section reco existante de la
  fiche cm_targets restent fonctionnelles pendant la transition; l'ecran
  Auto Prep les remplace comme entree par defaut, il ne casse rien.

## Journal de livraison

### Phase 1 — moteur pur + tests — LIVREE (13/07/2026)

Tout dans `src/ui/assets/js/build_recommender.js` (pur, teste), zero UI. Suite
`node --test tests/js/*.mjs` verte (204), backend inchange.

- **1a** `scoreSupportForTarget(summary, targetProfile, weights?)` : score sur
  les `effective_effects` de la projection roster-view (valeur au niveau reel).
  Modele = `SUPPORT_FAMILY_WEIGHTS` (friendship 100, training 85, specialty 55,
  wisdomRecovery 45, statGain 35, bond 30... documentes dans le module) x
  `current_value / SUPPORT_EFFECT_REFERENCE[effect_id]` (magnitude "strong
  maxed" calibree sur les `max_value` du dataset). Modulation distance mineure
  et etiquetee (familles energie/recuperation x1.2 en long). Sortie
  `{score, reasons[]}`, `weights?` = hook meta (phase 4) qui override familles
  ou references. `recommendSupportDeck` classe desormais par ce score (le mix de
  types devient une contrainte de composition), garde le proxy rarete+LB en
  fallback ETIQUETE quand une carte n'a pas de projection, et expose `picks[]`
  avec `{score, reasons[], hasProjection}` par carte. `catalog.js` fournit
  `effectiveEffects` depuis `derived.effective_effects`.
- **1b** `recommendParentSpec(targetProfile, charItem, buildSkills)` : rose =
  aptitudes cible ou le perso est < A (priorite distance > surface > style ;
  1 gap = les deux parents le chassent, 2 gaps = repartis), bleu = 2 stats les
  plus contraintes (heuristique distance->stamina, comme Feasibility), blancs =
  `related_races` (portes par `targetProfileFromCmDetail`) + skills du build.
  Sortie 2 specs + gaps + shopping list blancs + `reasons[]`. **Spec, jamais de
  parents concrets** (decision figee).
- **1c** `SCENARIO_NOTES` (table curee, source "curated") + `recommendScenario`
  (confiance "curated-match" seulement si distance+surface matchent, ex L'Arc en
  long turf ; sinon "low" + "pick your most practiced"). Remplacee par la meta
  en phase 4.
- **1d** `recommendSkillsForBuild` accepte un `courseZoneCounter` optionnel ;
  `makeSkillZoneCounter(course, resolveStaticZonesFn)` reutilise
  `resolveStaticZones` du visualizer par injection (module pur, zero DOM). Bonus
  GATED : applique uniquement si la cible resout UNE piste (garde-fou
  `getBuildTargetRacetrack`, comme Feasibility). Raison : "activates on N zones".
- **1e** `buildAutoPrepPlan(target, rosterData, options?)` : UN objet plan
  serialisable (uma retenue + alternatives, style, stats, deck, skills, scenario,
  spec parents), `reasons[]` partout, hooks (`buildSkillPool`, `course`,
  `resolveStaticZones`, `weights`) passes via `rosterData`. API unique pour l'UI.
  Verifie par un spike sur donnees reelles (p_001 : 42 umas, 167 supports tous
  projetes, cible Gemini Cup Long Turf) : deck coherent sur valeurs reelles,
  L'Arc curated-match, parents honnetes (pas de pink quand deja A en long).

Poids du deck : choisis a la main, documentes dans le module, a confronter aux
premiers usages reels puis a la meta. Pas de pretention d'optimum.

### Phase 2 — UI Auto Prep — LIVREE (13/07/2026)

Route `#/prep[/:targetId]` (gate-like, sidebar visible), branchee via
`currentRouteState`/`setPrepHash`, la section sidebar "CM Prep" et le CTA home.
Rendu dans `#profileGate` par `renderPrepPage` (app.js). Verifie en navigateur
de bout en bout sur le roster reel p_001. Suite JS verte (211).

- **Pont DOM/moteur unique**: `catalog.buildAutoPrepPlanForDetail(detail, opts)`
  assemble le `rosterData` (owned chars, support summaries avec
  `effective_effects`, pool de skills kit+deck, `course` via
  `getBuildTargetRacetrack` = garde-fou piste unique, `resolveStaticZones`) et
  appelle `buildAutoPrepPlan`. Le moteur reste pur (tout injecte).
- **Glue pure testee** dans `prep.js`: `selectDefaultTargetId` (CM courante ->
  prochaine -> derniere passee, gere "aucune CM future") et `planToBuildSeed`
  (plan -> seed d'editeur).
- **Page de plan**: uma retenue + alternatives cliquables (re-genere via
  `selectedCharacterId`), style, stats (etiquete heuristique), **deck 6 cartes
  avec raisons PAR CARTE** sur valeurs reelles + **swap par slot**
  (`recommendSupportDeck` gagne `pinnedIds`/`excludedIds` + `benchByType`;
  `buildAutoPrepPlan` propage `pinnedDeckIds`/`excludedDeckIds` -> le plan entier
  se recalcule), skills, scenario (badge "curated"), spec parents, chaque
  section avec un "why" depliable.
- **Readouts deterministes**: `renderBuildFeasibilityPanel` +
  `renderBuildSpurtPanel` reutilises tels quels via une entry synthetique
  (meme garde-fou "piste unique": affiche "Track ambiguous" sinon).
- **Actions**: swap par slot + Reset swaps, Regenerate, **Save as build draft**
  (seed de l'editeur existant, aucune ecriture roster). L'ancienne reco de la
  fiche `cm_targets` reste fonctionnelle (compat).

**Correctif scenarios Global-only** (retour utilisateur): la reco ne doit
proposer que des scenarios sortis en version **Global**. Source de verite =
GameTora, comme les cartes (`available.en`): `normalize_scenarios` porte
desormais `name_en` (nom Global) et `start_en` (date de sortie Global, unix, ou
`null`). `catalog.getGlobalAvailableScenarios()` derive l'ensemble disponible
(`start_en` present ET <= maintenant); `recommendScenario(profile,
{ availableScenarios })` ne considere que ceux-la, affiche le **nom Global**, et
renvoie `confidence: "none"` si rien de connu n'est dispo. Aujourd'hui Global =
URA Finale, Unity Cup (Aoharu), Trackblazer (Climax) — une cible Long Turf
suggere Unity Cup (confiance basse), plus jamais L'Arc. Regenerer les donnees
via `scripts/update_reference.py` pour que `start_en` arrive dans
`reference-data.js` (gitignore).

### Phase 3 — boucle reelle — LIVREE (13/07/2026)

Section **"Past runs on this target"** sur la page de plan: filtre les
`run_results` par `target_id` (`getRunsForTarget` dans core.js) et affiche, du
plus recent au plus ancien, chaque run reel (issue Win/Loss/Untested, uma, style,
stats finales, notes). Helper pur teste `summarizeTargetRuns` (prep.js). Section
absente s'il n'y a aucun run pour la cible. Lien retour: l'onglet Runs de
l'editeur gagne un bouton **"Compare in CM Prep"** (-> `#/prep/:target_id`).
Verifie en navigateur (motif net-zero: build+run cobaye crees via l'API,
section confirmee, puis supprimes).

Reste: Phase 4 (meta/uma.moe via les `weights?`), cadree separement.

### Phase 4 — spike meta uma.moe — FAIT (13/07/2026) — VERDICT: GO

Detail complet dans `EXTERNAL_SOURCES_PLAN.md` ("Spike uma.moe"). Les trois
inconnues bloquantes sont levees: **couverture Global forte** (~25 M umas
trackes cote Global), **mapping d'IDs = identite** (les IDs uma.moe sont les IDs
du jeu = les notres, supports et persos), **API publique joignable** (`/api/health`,
`/api/stats`, `/api/v3/search` en 200) mais **rate-limitee** sur `/api/v4/rankings/*`
(429) -> snapshots locaux dates obligatoires (ce qui etait deja l'archi visee).
GO pour construire la brique Meta en snapshots + injection via les `weights?`.

### Phase 4 — implementation meta — LIVREE (13/07/2026)

Brique `Meta / Insights` posee, en snapshots locaux dates, injectee via les
hooks `weights?` (aucune dependance runtime a uma.moe). Suite verte (225 JS,
Python OK). Verifie en navigateur sur donnees reelles.

- **`meta.js`** (pur, teste): `buildMetaWeights(snapshot)` -> `weights`
  (`supportMeta` bonus par carte **borne** a `META_SUPPORT_BONUS_MAX=40`, bien
  sous le poids Friendship 100; `characterMeta` popularite; source/date). Meta
  = additif, borne, **toujours etiquete** -> raffine sans jamais renverser la
  formule verifiee. IDs = identite (uma.moe = IDs du jeu = les notres).
- **Moteur**: `scoreSupportForTarget` ajoute le bonus meta + une raison
  `{ family: "meta" }` (`metaBonus`); `buildAutoPrepPlan` utilise `characterMeta`
  uniquement comme **tiebreaker a fit egal** (le fit d'aptitude reste la verite
  primaire) + note; expose `plan.meta.snapshot/applied`.
- **Wiring/UI**: `loadMetaSnapshot()` charge best-effort `data/meta/latest.json`
  (un 404 est normal -> app identique sans meta); `buildAutoPrepPlanForDetail`
  plie le snapshot dans les weights. UI: note "Weighted by community meta",
  puce "META: <label>" sur l'uma, badge "meta +N" sur les cartes boostees.
- **Acquisition**: `scripts/fetch_meta_snapshot.py` (offline, poli: `--pages`,
  `--delay`, backoff 429) agrege `/api/v3/search`, ecrit
  `data/meta/uma_moe/<date>.json` + `latest.json` (+ copie dist). `data/meta/`
  gitignore. Snapshot reel valide: top supports Fine Motion/Kitasan/Super Creek,
  top umas Nishino Flower/Gold Ship/Oguri Cap — mapping identite confirme en
  reel. Relancer avec plus de `--pages` pour une distribution plus fine.

Chantier Auto Prep: **Phases 1-4 livrees.** Suites (M2 avancees) possibles:
meta scenario, snapshots plus larges/planifies, badge meta plus riche.

## Estimation

- Phase 1: le gros morceau (~2-3 sessions), surtout 1a et 1e
- Phase 2: ~1-2 sessions (beaucoup de reutilisation: panneaux, seed, cartes)
- Phase 3: ~0.5 session
- Phase 4: cadree separement (spike d'abord)
