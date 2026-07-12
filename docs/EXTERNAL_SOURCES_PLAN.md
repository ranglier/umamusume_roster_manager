# External Sources Plan

## Objet

Ce document cadre l'integration de sources externes complementaires a GameTora pour renforcer l'application avant le vrai moteur de build CM.

Le but n'est pas de remplacer la reference locale actuelle, mais d'ajouter deux nouvelles briques separees:

- `Visualizers`
- `Meta / Insights`

Ces briques doivent rester compatibles avec la philosophie actuelle du projet:

- reference locale stable
- pas de dependance runtime directe a un site tiers
- logique explicable
- separation stricte entre donnees canoniques, outils visuels et meta mouvante

## Sources etudiees

### 1. alpha123 / uma-tools

Sources:

- `https://alpha123.github.io/uma-tools/skill-visualizer-global/`
- `https://github.com/alpha123/uma-tools`
- `https://github.com/alpha123/uma-tools/blob/master/package.json`
- `https://github.com/alpha123/uma-tools/blob/master/skill-visualizer-global/build.mjs`
- `https://github.com/alpha123/uma-tools/blob/master/skill-visualizer/app.tsx`

Constat:

- le projet fournit un visualisateur de skills sur course tres pertinent
- il s'appuie sur une logique de piste, de zones d'activation et de conditions de skills
- il est tres utile pour lire une race cible et, plus tard, un build CM
- le depot est publie sous `GPL-3.0-or-later`

Conclusion:

- tres bonne source d'inspiration fonctionnelle et technique
- integration directe du code a arbitrer soigneusement a cause de la licence
- le meilleur point d'entree pour notre projet est une brique `Visualizers`

#### Pourquoi la licence `GPL-3.0-or-later` impose de la prudence

Le depot `uma-tools` est publie sous une licence `GPL-3.0-or-later`.

Concretement, cela veut dire:

- il est possible de lire et d'etudier le code
- il est possible de s'en inspirer fonctionnellement
- mais l'integration directe de code GPL dans notre projet peut imposer des obligations fortes sur la redistribution du projet

Point pratique pour ce projet:

- copier du code, des composants ou des modules de `uma-tools` dans notre application serait un choix juridiquement plus sensible
- la voie la plus prudente est donc:
  - etudier le comportement
  - reimplementer localement notre propre visualizer
  - ou, a defaut, garder un lien externe optionnel sans embarquer leur code

Ligne retenue pour l'instant:

- inspiration fonctionnelle et technique: oui
- copie directe du code: non, sauf arbitrage explicite de licence plus tard

### 2. uma.moe

Sources:

- `https://uma.moe/tools/statistics`
- `https://uma.moe/tierlist`
- `https://github.com/Tunnelbliick/umamoe-backend`
- `https://github.com/Tunnelbliick/umamoe-backend/blob/main/README.md`
- `https://github.com/Tunnelbliick/umamoe-backend/blob/main/src/main.rs`
- `https://github.com/Tunnelbliick/umamoe-backend/blob/main/src/handlers/search.rs`
- `https://github.com/Tunnelbliick/umamoe-backend/blob/main/src/handlers/stats.rs`

Constat:

- le site expose une couche meta potentiellement tres utile pour les builds
- le backend visible est surtout oriente recherche inheritance / supports / service API
- les donnees meta semblent plus mouvantes, observables et communautaires que canoniques

Conclusion:

- source pertinente pour une brique `Meta / Insights`
- a garder separee du coeur de reference
- utile plus tard pour deck choice, candidate choice, priorites meta et signaux d'aide a la decision

## Architecture cible

### 1. Reference

Cette couche reste le noyau stable du projet.

Elle contient:

- les imports GameTora
- les schemas normalises
- la base SQLite locale
- le roster utilisateur
- la couche `legacy`

La reference ne doit pas etre polluee par des donnees meta ou par un code de visualisation tiers.

### 2. Visualizers

Nouvelle brique dediee aux outils visuels et explicatifs.

Responsabilites:

- visualiser des skills sur une course
- visualiser l'activation probable de skills selon le track
- aider a comprendre une `race`, une `cm_target`, puis un futur `build`

Cette couche:

- ne cree pas de verite metier
- ne remplace pas le moteur de build
- sert d'aide a la lecture

### 3. Meta / Insights

Nouvelle brique dediee aux donnees mouvantes et observees.

Responsabilites:

- stocker des snapshots meta
- exposer des signaux de popularite / tierlist / tendances
- enrichir plus tard les decisions de build

Cette couche:

- ne remplace pas le referentiel canonique
- ne doit jamais ecraser la reference
- doit etre datee et tracee par source

## Plan d'implementation recommande

### Phase V1. Fondations `Visualizers`

Objectif:

- preparer une brique `Visualizers` sans encore integrer uma.moe

Travail:

- ajouter une section `Visualizers` dans l'architecture du projet
- definir un contrat de donnees local pour un visualizer de course:
  - `race_id`
  - `racetrack_id`
  - distance
  - surface
  - direction
  - layout phases
  - liste de skills a afficher
- preparer les points d'entree UI:
  - detail `races`
  - detail `cm_targets`

Choix:

- pas de dependance runtime au site `alpha123.github.io`
- pas de code tiers importe tel quel dans cette premiere tranche

### Phase V2. `Race Skill Visualizer` MVP

Objectif:

- creer un premier visualizer local utile et lisible

Premiere cible UI:

- detail `races`

Seconde cible UI:

- detail `cm_targets`

Rendu attendu:

- representation simple du track
- overlay de zones d'activation par skill
- affichage de skills selectionnees
- lecture claire des sections "utile / peu utile / hors zone"

Approche recommandee:

- s'inspirer de `uma-tools`
- reimplementer localement un MVP adapte a notre schema
- garder la porte ouverte a une integration plus profonde plus tard

## Faisabilite d'un visualizer maison

### Estimation generale

Oui, un visualizer maison est faisable a partir de la reference locale actuelle.

Pourquoi:

- le projet possede deja `races`
- le projet possede deja `racetracks`
- le projet possede deja `skills`
- le projet possede deja `cm_targets`
- l'UI locale a deja les fiches detail et les points d'entree utiles

La difficulte principale n'est pas le rendu graphique.

La vraie difficulte est:

- l'interpretation correcte des conditions de skills
- la projection de ces conditions sur une course visualisable
- la couverture progressive des cas simples puis complexes

### Niveau de difficulte estime

- MVP `races` seulement: difficulte `moyenne`
- version `races + cm_targets`: difficulte `moyenne a elevee`
- version vraiment orientee `build CM`: difficulte `elevee`

### Estimation de charge

Estimation de travail pour une implementation maison, en restant prudents:

- `Race Skill Visualizer` MVP pour `races`
  - `3 a 6 jours`
- version plus solide pour `races + cm_targets`
  - `1 a 2 semaines`
- version vraiment exploitable comme brique du futur moteur de build
  - `2 a 4 semaines`

Ces estimations supposent:

- une reimplementation locale
- pas de reprise directe du code GPL
- une progression incrementale de la couverture metier

### Ce que le MVP peut couvrir rapidement

Les familles de conditions les plus utiles et les plus realistes pour un premier MVP sont:

- `corner`
- `straight`
- `final corner`
- `final straight`
- `uphill`
- `downhill`
- grandes phases de course (`mid`, `end`)

Ces cas sont suffisants pour livrer un visualizer qui apporte deja une valeur forte sur:

- la lecture des `races`
- la lecture des `cm_targets`
- la preparation du futur planner de build

### Ce qui sera plus couteux

Les cas suivants seront plus longs a traiter proprement:

- conditions dependantes du classement
- conditions dependantes des adversaires
- conditions contextuelles complexes ou combinees
- cas a forte part probabiliste

Conclusion produit:

- un visualizer utile est atteignable rapidement
- un visualizer exhaustif et tres proche du comportement complet du jeu demandera une montee en couverture progressive

### Phase V3. Extension du visualizer vers les builds

Objectif:

- reutiliser la brique dans la future couche `builds`

Usage cible:

- visualiser les skills retenues pour un draft CM
- voir les overlaps ou les trous de couverture
- comparer plusieurs packages de skills sur une meme cible

Cette phase ne doit commencer qu'apres le MVP local sur `races` et `cm_targets`.

### Phase M1. Fondations `Meta / Insights`

Objectif:

- preparer la structure de stockage de donnees meta sans encore en faire une dependance forte

Ajouts recommandes:

- dossier logique `data/meta/`
- ou tables SQLite dediees namespacees `meta_*`

Entites candidates:

- `meta_tierlists`
- `meta_statistics`
- `meta_support_popularity`
- `meta_character_popularity`

Champs minimaux:

- `source`
- `region`
- `collected_at`
- `context_label`
- `payload_json`

Principe:

- snapshots dates
- import local explicite
- pas de sync silencieuse a l'ouverture de l'app

### Phase M2. Adaptateur `uma.moe`

Objectif:

- ajouter un adaptateur d'ingestion separe pour exploiter ce qui est stable et utile

Regles:

- ne rien brancher directement sur `uma.moe` a l'execution de l'UI
- importer en snapshot local
- conserver la provenance et la date de collecte

Usages cibles:

- indicateurs meta dans les fiches `characters`
- indicateurs meta dans les fiches `supports`
- signaux additionnels dans les futures fiches `cm_targets`
- support de priorisation pour les futurs builds

### Phase M3. Reemploi conceptuel de `umamoe-backend`

Objectif:

- reutiliser les idees du backend `umamoe-backend` pour notre propre moteur local

Cible:

- recherche `legacy`
- recommandation de parents
- preparation des heuristiques de build

Important:

- cette phase concerne surtout l'architecture de recherche et les filtres
- pas une copie 1:1 du backend externe

## Choix structurants

### `Visualizers` avant `Meta / Insights`

Pourquoi:

- valeur immediate sur la lecture des races et CM
- dependance plus faible a une source externe mouvante
- directement utile avant meme l'arrivee d'un moteur de build complet

### `Meta / Insights` separe de la reference

Pourquoi:

- les donnees meta sont mouvantes
- elles ne doivent pas contaminer les schemas canoniques
- elles doivent rester facultatives, datees et auditables

### Pas de dependance runtime aux sites tiers

Pourquoi:

- respect de l'architecture locale du projet
- robustesse
- consultation offline
- limitation des regressions si une source externe change

### Prudence sur la licence de `uma-tools`

Pourquoi:

- la presence de `GPL-3.0-or-later` rend une reutilisation directe du code plus sensible
- le projet doit donc privilegier:
  - soit une integration externe optionnelle
  - soit une reimplementation locale inspiree du comportement

## Risques et limites

- le visualizer local demandera un vrai travail de modelisation sur les zones d'activation
- `uma.moe` peut changer plus vite que GameTora
- les signaux meta peuvent etre region-specific ou date-sensitive
- le backend `umamoe-backend` n'expose pas, dans l'etat observe, une API meta simple et stable equivalente a tout le site public

## Statut: Race Skill Visualizer MVP livre

La brique `Visualizers` recommandee ci-dessous a ete posee. Un premier
`Race Skill Visualizer` est en place sur la fiche detail `racetracks`
(`src/ui/assets/js/visualizer.js`, teste dans `tests/js/test_visualizer.mjs`):

- vue lineaire (pas un ovale — les donnees `racetracks` sont 1D, pas de
  geometrie de courbe/(x,y)) avec bandes virages/lignes droites/pentes et
  reperes de phase
- parseur des conditions d'activation de skill (chaines booleennes
  `variable OPERATOR value` jointes par `&`/`@`, non echappees en HTML,
  verifie contre les vraies donnees GameTora importees)
- allowlist de variables statiquement projetables sur la piste
  (`is_finalcorner`, `is_lastcorner`, `is_last_straight`, `is_laststraight`,
  `phase`, `phase_random`, `remain_distance`, `slope`) vs variables
  dynamiques (`order`, `order_rate`, `bashin_diff_*`, etc.) volontairement
  non projetees — affichees comme badges texte plutot que fabriquees en zone
- selecteur de skill par recherche (recyclant le pattern de
  `getFilteredLegacyTargetOptions`), zero changement backend

Deja branche gratuitement sur `cm_targets` (son "Related Racetracks"
existant navigue deja vers la fiche `racetracks`). Pas encore branche sur
`races`: cette entite n'a aujourd'hui aucun champ `related_racetracks` (a la
difference de `cm_targets`, qui a deja cette logique de matching
cote serveur dans `normalize_cm_targets()`) — l'ajouter demanderait un vrai
changement backend, volontairement hors perimetre de ce MVP.

Prochaine tranche recommandee: seulement apres, cadrer un adaptateur
`Meta / Insights`.

## Spike uma.moe (Meta / Insights) — 13/07/2026 — VERDICT: GO

Spike empirique (sondage direct de l'API + backend `Tunnelbliick/umamoe-backend`,
appele "honsemoe-backend" en prod) pour trancher les trois inconnues bloquantes
avant tout code Meta. Prerequis d'Auto Prep Phase 4 (hooks `weights?` deja en
place cote moteur).

**1. Couverture Global — OUI (fort).** uma.moe se decrit comme la plateforme
"for the global version"; `/api/stats` (public) renvoie **~25,3 M umas trackes,
2,18 M comptes/7j, ~795 k comptes/24h** — un dataset Global massif et courant,
alimente par les donnees uploadees des entraineurs Global. Pas de colonne region
cote backend (le filtrage region est implicite: la source EST le playerbase
Global).

**2. Mapping d'IDs — IDENTITE (le risque principal disparait).** Les IDs
uma.moe sont les IDs numeriques du jeu, identiques aux notres:
- supports: `support_card_id` = notre `id`/`support_id` (5 chiffres, rarete
  encodee dans le 1er chiffre — ex. `10001` = R Special Week).
- personnages: card ids 6 chiffres (ex. `main_parent_id: 105101`) = notre
  `characters.id` (`card_id`); base perso = `card_id / 100` = notre
  `base_character_id`. Le backend fait exactement cette normalisation
  (`if id >= 10000 { id / 100 }`).
Aucun cross-reference fragile a maintenir (contrairement au mapping d'icones).

**3. Donnees fetchables — OUI, avec reserve.** API publique live:
`/api/health`, `/api/stats`, `/api/v3/search` repondent **200** en GET (JSON
propre). `/api/v3/search` expose les enregistrements reels d'heritage/emprunt:
`main_parent_id`, `parent_left_id`/`parent_right_id`, `blue/pink/green/white_sparks`,
`borrow_view_count`, `borrow_copy_count`, `win_count`, `last_updated` — signaux
directement exploitables (popularite deck/support, tier perso, distributions de
sparks pour la spec parents). **Reserve:** `/api/v4/rankings/*` existe mais
**rate-limite (429)** au bout de quelques requetes rapides — il FAUT snapshoter
poliment (basse frequence, backoff). Cela colle a l'archi deja decidee:
snapshots locaux dates, aucune dependance runtime.

**Verdict: GO** pour une brique `Meta / Insights` en snapshots locaux dates,
injectee via les `weights?` du moteur. Le concern historique ("pas d'API meta
simple et stable") est nuance: l'API existe et est joignable, mais la tierlist
"pretes a l'emploi" passe par `/api/v4/rankings/*` (params exacts + shape a
finaliser sous rate-limit) OU par agregation cote-nous de `/api/v3/search`.

**Premieres taches Phase 4 M2 (quand elle sera lancee):**
- finaliser l'endpoint + params de `/api/v4/rankings/*` (shape par-support /
  par-perso) sous acces rate-limite poli; sinon agreger `/api/v3/search`.
- script de snapshot date -> `data/meta/uma_moe/<date>.json` (gitignore comme
  `data/raw`), jamais appele a l'execution de l'UI.
- adaptateur pur qui transforme un snapshot en `weights` (familles de support,
  tier d'uma, popularite deck) + badge "meta" dans les `reasons[]`.
- alternative/complement open-source note: `Euophrys/umamusume-tierlist`
  (`src/cards/gl.js` = Global, `jp.js` = JP) — tier FORMULE (calcule depuis
  master.db), fetchable/versionnable, mais recouvre en partie notre propre
  `scoreSupportForTarget`; utile comme repere de calibration, pas comme source
  de popularite reelle.

Cette sequence maximise:

- l'utilite immediate
- la robustesse
- la coherence avec le futur moteur de build CM

## Import et synchronisation du roster depuis le jeu

Troisieme source externe etudiee, distincte des deux precedentes: non pas des
donnees meta ou de visualisation, mais les **donnees de compte du joueur**
(cartes possedees, niveaux, MLB, uma, stars, awakening).

### Probleme

Le principal frein a l'usage reel de l'app n'est pas la qualite des recos mais
le cout d'**entree ET de maintenance** du roster: plusieurs centaines de support
cards a des MLB/niveaux differents, plusieurs dizaines d'uma a des stars/
awakening differents, qui evoluent en continu. Sans import rapide + mise a jour
incrementale, l'app reste sous-utilisee au profit d'un LLM externe (ChatGPT)
nourri de screenshots. Voir memoire projet
`project_cm_prep_workflow_and_frictions`.

### Voie "API serveur / capture de paquets": ecartee pour un joueur global

Recherche menee (juillet 2026):

- pas d'API publique Cygames exposant les donnees de compte
- la DB locale (`master.mdb` + `meta`) ne contient que la **reference**
  (definitions cartes/skills), deja couverte par GameTora; le roster possede
  n'y est pas, il vient du serveur
- l'ecosysteme qui reconstruit le roster passe par la **capture de paquets**
  (famille CarrotJuicer, hook de `libnative.dll`, enrobe par UmaLauncher),
  concu et maintenu pour la version **DMM japonaise**
- le compte de l'utilisateur est **global** (client Steam, sorti le 25 juin
  2025), liable au PC via Data Link, mais: aucun outil maintenu ne fait de
  capture de paquets sur le client Steam global (non confirme, ecosysteme reste
  DMM); Steam EN et DMM JP partagent le meme dossier d'install; le compte global
  n'est pas jouable sur le client DMM JP

Conclusion: pour un joueur global, **il n'existe pas aujourd'hui de pipe roster
fiable via serveur/paquets**. A surveiller (Steam est jeune) mais pas a attendre.

### Voie retenue par elimination: OCR / screenshot + reconciliation

Toute la tooling active pour la version globale lit l'etat du jeu par
OCR/capture d'ecran, pas par paquets — signal fort que l'OCR est l'approche
pragmatique sur global. Avantages:

- **ToS-safe** quand elle se limite a lire une image (voir risques ci-dessous)
- multiplateforme (peut meme tourner cote telephone)
- adaptee a la maintenance: penser **"reconciliation"** plutot qu'"import" —
  l'utilisateur re-shoote les cartes qui ont bouge, l'app calcule un diff contre
  le roster stocke et propose les changements a confirmer

L'export `.zip` de profil existant (roster + builds + runs) sert deja le cote
"consommation sur telephone" du decouplage PC-authoring / phone-consumption.

### Projets communautaires OCR (references techniques, pas des dependances)

Categorises par mecanisme, car le mecanisme determine le risque de ban:

**Lecture seule par OCR / capture d'ecran (risque faible):**

- GameTora Training Event Helper — `https://gametora.com/umamusume/training-event-helper`
- IRMINSUL Training Event Helper — `https://irminsul.gg/uma/training-event-helper`
- daftuyda / UmaTools — `https://github.com/daftuyda/UmaTools`
- steve1316 / uma-android-training-helper — `https://github.com/steve1316/uma-android-training-helper` (OCR **sur Android**, tourne sur le telephone)

**OCR + automation / mods (risque eleve, NON necessaires pour lire un roster):**

- watsonjph / UmaTrainerTools — `https://github.com/watsonjph/UmaTrainerTools` (batti sur Trainers-Legend-G: auto-train, FPS unlock, freecam)
- suchxs / UmaTrainerTools — `https://github.com/suchxs/UmaTrainerTools`

**Capture de paquets (DMM only, hors sujet pour un compte global):**

- CNA-Bld / CarrotJuicer — `https://github.com/CNA-Bld/CarrotJuicer`
- KevinVG207 / UmaLauncher — `https://github.com/KevinVG207/UmaLauncher`

### Evaluation du risque de ban

Precision honnete: pas de statistiques de ban fiables sous la main; les CGU
interdisent largement les outils tiers, mais l'application concrete cible
surtout l'automation et la triche, pas la lecture passive d'ecran. Par paliers
de risque croissant:

- **Tier 1 — screenshot passif / OCR hors-ligne** (l'app parse une image fournie
  par l'utilisateur): risque **quasi nul**. Le jeu n'est jamais touche; c'est
  l'equivalent de lire une capture d'ecran. **Approche recommandee.**
- **Tier 2 — capture d'ecran live du jeu** (OCR temps reel, lecture seule):
  risque **faible**. Lecture passive de la fenetre, aucune modification du
  process ni du reseau. Les event helpers OCR sont ici.
- **Tier 3 — automation / envoi d'inputs** (auto-trainers): risque **eleve**.
  L'automatisation du gameplay est typiquement interdite et ciblee par les bans.
- **Tier 4 — mods memoire / injection DLL** (Trainers-Legend-G, hachimi, FPS
  unlock, freecam) **et capture de paquets** (CarrotJuicer): risque **le plus
  eleve**. Hook/modification du process. Tolere historiquement cote DMM mais
  formellement bannissable, et l'anti-triche global est plus recent.

Pour lire un roster, seuls les Tier 1/2 sont pertinents; le Tier 1 est a la fois
le plus sur ET le meilleur fit.

### Approche recommandee pour l'app

- import roster par **OCR d'images fournies par l'utilisateur** (screenshots des
  ecrans d'inventaire), parse **hors-ligne** — Tier 1
- **ne pas** embarquer d'automation ni de mod/injection (Tier 3/4): inutile pour
  lire un roster et seule vraie source de risque
- **flux de reconciliation** (diff + confirmation) pour la maintenance continue
- philosophie offline: si un modele de vision est utilise, arbitrer **local vs
  API** (le local preserve l'offline; une API vision est plus simple a batir
  mais introduit une dependance runtime et un cout)

### Faisabilite validee sur captures reelles (juillet 2026)

Test mene sur 3 captures reelles du client (2 grilles support cards filtrees
Speed/Wit, 1 grille umas "Trainee Umamusume"). **Decision: on construit
l'import par screenshot.**

Catalogue de match deja present dans le repo:

- `dist/media/reference/supports/*.png` — 1075 images indexees par **ID de carte**
- `dist/media/reference/characters/<groupe>/<id>.png` — 258 images d'umas

Lisible directement en **vue grille** (sans ouvrir chaque carte — point cle):

- supports: rarete (badge SSR/SR/R), type (icone haut-droite; le **filtre par
  type est un aide-capture** — une salve = un seul type), niveau (`Lvl XX`),
  limit break (rangee de 4 gemmes en bas a gauche), possession (`Held 171/225`)
- umas: **etoiles (rang) ET `Potential Lvl`** — correction importante: le
  "Potential Lvl" affiche **EST le niveau d'awakening**. Donc les deux champs
  roster uma (stars + awakening) sont presents dans la vue liste

Methode d'identite retenue: **match d'image** (perceptual hash / template
matching) de la vignette contre le catalogue indexe par ID — **pas** de l'OCR de
nom (souvent absent en grille). Plus fiable qu'une reconnaissance semantique car
la vignette in-game et l'image de reference sont le meme artwork.

Points durs identifies (tous rattrapes par l'etape "diff a confirmer"):

- recadrage de la vignette vs l'image de reference avant le hash (crops
  potentiellement differents)
- comptage precis des gemmes de limit break a la resolution d'une grille
- versions d'art quasi identiques (alt outfits) ou le match peut hesiter

Volumetrie: ~30 cartes/ecran, 171 supports possedes -> ~6 captures. Gerable.

### Spike de matching execute (juillet 2026) — verdict et methode retenue

Decisions prealables: moteur **CV locale** (pas de modele de vision — arbitrage
"local-first, integre a l'app" et perspective de packaging => cible finale
**cote navigateur JS/Canvas**, le spike jetable etant en Python+Pillow), MVP
**umas d'abord**, libs externes seulement si le fait-maison est trop lourd.

Resultat du spike (grille umas 35 cellules, capture 1080x2392):

- decoupe de grille: OK (geometrie fixe calee sur la resolution du telephone
  de l'utilisateur — simplification assumee, un seul appareil)
- **decouverte structurante**: il n'existe **aucun asset public identique a
  l'icone visage in-game** des umas. Nos `chara_stand_*` (en pied, pose libre)
  et les `chr_icon_*` GameTora (buste circulaire, 41/131 seulement) cadrent
  differemment -> tout matching pixel-a-pixel naif (dHash, NCC mono/multi-
  echelle, gris ou RGB) echoue completement, teste et confirme ~5 fois
- **meilleur asset trouve**: `characters/thumb/chara_stand_<chara>_<variant>.png`
  (GameTora, 128x128, fond alpha, **258/258 variantes couvertes**, URL
  previsible depuis nos donnees). A ajouter au pipeline d'assets
- **methode qui marche**: histogramme de couleurs 3D (6x6x6 bins) — insensible
  a l'alignement/echelle, trivial a porter en JS/Canvas. Cote thumb: pixels
  alpha>128 uniquement (sinon le fond compose contamine le match, teste);
  cote cellule: suppression des 1-2 bins dominants (fond de carte).
  Suzuka test: 0.545 vs 0.441 au 2e (gap net)
- **precision brute sur les 35 cellules: ~40-50% top-1, 9/35 "confiants"**
  (gap>=0.05), le bon perso souvent dans le top-2-3; deux variantes du score
  (palette tenue entiere vs palette tete seule via bbox alpha) font des
  erreurs *differentes* -> un score combine devrait monter sensiblement

Consequences pour l'implementation reelle:

1. l'UI de reconciliation n'est pas un filet de securite optionnel, c'est
   **le coeur du produit**: proposer le **top-3** par cellule (dropdown
   pre-rempli), l'utilisateur confirme/corrige — meme a 50% top-1, corriger
   ~15 cellules via un choix pre-mache bat totalement la saisie manuelle
2. score combine (palette tenue + palette tete + forme grossiere) a
   construire et calibrer sur les vraies captures
3. **le cas `supports` (le vrai volume, 1075 cartes) devrait etre BEAUCOUP
   plus facile**: nos images de reference supports sont le *meme artwork*
   que la grille in-game (la ou les umas n'ont pas d'asset equivalent) —
   le matching pixel/dHash devrait y etre quasi exact. Ironie du sequencement:
   les umas choisies comme cas "facile" (moins nombreuses) sont en realite le
   cas *dur* cote assets. Valider par un mini-spike supports avant de figer
   la conception du matcher
4. ajouter les thumbs umas au pipeline d'update (nouvelle famille d'assets)

### Mini-spike supports (juillet 2026): cas resolu, 30/30

Confirme sur une capture reelle (grille 6x5, filtre Speed, 1080x2392):

- comparaison **illustration pleine locale** (450x600, meme ratio 3:4 et meme
  artwork que la grille in-game) contre la zone d'art de la cellule
  (fractions identiques des deux cotes: x 10-90%, y 14-78%)
- score ensemble: dHash 64 bits (min sur 5 jitters de boite de +/-2%) combine
  a l'histogramme couleur 6x6x6 (`d - 10*intersection`)
- resultat: **30/30 top-1 corrects** (verification visuelle), 28/30 au-dessus
  du seuil strict (d<=12, gap>=2), distances typiques d=2-11 avec gaps enormes
- important: matcher contre les **illustrations pleines** (`supports/*.png`),
  PAS contre `supports/icons/*.png` (128x128, cadrage different, 0/30 — meme
  piege que les icones umas)
- aucun nouvel asset a importer: le catalogue local actuel (534 illustrations)
  suffit

L'identite matchee donne gratuitement rarete/type via la reference. Ce qui
reste a lire sur la capture = **l'etat utilisateur seulement**: niveau
("Lvl XX", OCR de chiffres par template) et limit break (comptage des 4
gemmes, detection de couleur a positions connues).

### Statut et decision de perimetre

**Decision (juillet 2026): le MVP d'import se concentre sur les `supports`**
(cas resolu 30/30, et c'est le vrai volume: ~170 cartes possedees). Le
matching **umas est abandonne pour l'instant** (~40-50% top-1 faute d'asset
public au bon cadrage) — les umas restent saisies a la main (dizaines, moins
douloureux) ou attendront une meilleure source d'asset. Prochaines etapes:
construction du flux d'import supports (moteur JS/Canvas portant la methode
du spike + lecture Lvl/LB + page d'import + diff/confirmation + PUT roster
existant).

Mise a jour: le MVP supports est livre (voir `docs/ROSTER_IMPORT_PLAN.md`,
phases A/B/C), et la decision "umas abandonnees" est **revenue** grace a une
nouvelle source d'asset — voir la section suivante.

### Umas debloquees: source d'icones par variante trouvee (juillet 2026)

Chasse a une source non-GameTora menee apres la livraison du MVP supports.
Ecartees: umapyoi.net (art promotionnel officiel, mauvais cadrage), uma.moe
(memes `character_stand` que GameTora), umamusu.wiki (icones buste par
personnage, pas par variante, cadrage different), Fandom (art officiel,
scraping bloque).

**Source retenue: `https://github.com/wrrwrr111/pretty-derby`** (outil
communautaire chinois, depot actif — dernier commit mars 2026). Le dossier
`public/img/chara_card/` heberge les **icones in-game extraites du jeu**,
nommees `chr_icon_<chara>_<variante>_01.png` (256x280) — l'asset exact de la
liste "Trainee Umamusume", par variante. 213 fichiers.

**Deblocage technique cle**: meme avec le bon asset, le match echouait
(8/35) car la vignette in-game est un **crop zoome fixe** de l'icone.
Transformation calibree par recherche brute sur la capture reelle:
`icone.crop((28, 46, 238, 227))` correspond pixel-perfect (dHash d=0) a la
zone d'art `(8, 8, 172, 150)` de la cellule 180x180. Constante de l'UI du
jeu, calibree une fois, valable pour toutes les cartes.

**Resultat sur la capture reelle umas (35 cellules)**: **32/35 confiants**
(d=0-9, gaps enormes — la qualite du cas supports), verifies visuellement.
La discrimination **par variante** fonctionne (Maruzensky ete -> 100402,
les deux McQueen -> 101301 et 101302). Les 3 "??" sont des variantes non
couvertes, correctement signalees plutot que mal matchees.

**Limites et risques assumes**:

- **couverture: 132/258** variantes du catalogue (le depot suit le rythme de
  son mainteneur, pas celui du jeu). Les manquantes tomberont en "Unknown"
  -> dropdown, comme les cas incertains supports
- **fraicheur dans le temps** (inquietude explicite de l'utilisateur): cette
  source peut se perimer la ou GameTora suit le jeu de pres. Decision: on
  l'utilise quand meme (elle debloque le cas umas aujourd'hui), et **on
  reste en veille pour une source plus complete/perenne** — le nommage
  `chr_icon_<chara>_<variante>` est celui des fichiers du jeu, d'autres
  miroirs existent probablement
- provenance: assets du jeu heberges sur GitHub — meme zone grise que les
  images GameTora, usage local personnel, pas de dependance runtime (fetch
  one-shot via script, voir `scripts/fetch_chara_icons.py`)

#### Veille sources japonaises (juillet 2026): pas mieux pour la precision

Chasse complementaire cote JP menee a la demande de l'utilisateur (inquiet
de la fraicheur de pretty-derby dans le temps). Resultats:

- **Game8** (`game8.jp/umamusume/225382`, liste des 育成ウマ娘): la seule
  source **complete et fraiche** trouvee — 254 variantes avec titre JP
  exact en alt (`［titre］nom`), mappables sur notre catalogue via
  `titles.ja`/`names.ja` (**237/258 en matching exact**; les ~21 restantes
  sont des divergences d'orthographe — ex. GameTora "tach-nology" vs Game8
  "tech-nology" — recuperables en matching flou). **MAIS images retraitees
  par leur CDN/uploads** (tailles heterogenes 100/205/440/1000px, recadrages
  incoherents d'un upload a l'autre, badge 新 incruste sur les recentes):
  calibration impossible (d=13-22 meme icone-contre-icone la ou pretty-derby
  donne d=0). **Inutilisable pour le matching de precision**; utile comme
  (a) liste de completude/veille des variantes existantes, (b) eventuel
  fallback faible niveau histogramme pour les variantes non couvertes
- gamedbs.jp: icones circulaires par personnage (mauvais asset)
- U-tools (ウマ娘.tools): icones par personnage + art officiel (mauvais asset)
- hakuraku: n'heberge aucune image
- forks de pretty-derby: le seul actif (shironue, pousse 2026-06) a les
  **memes 213 icones** — pas de miroir plus frais

**Critere degage pour evaluer toute future source**: seuls les assets bruts
du jeu se calibrent (d~0 sur une paire de reference); toute image retraitee
par un site (recompression, recadrage editorial) echoue. Le nommage a
chercher reste `chr_icon_<chara>_<variante>` dans des depots d'extraction.
