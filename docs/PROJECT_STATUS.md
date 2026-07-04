# Project Status

## Objet du projet

Ce projet couvre maintenant la phase 1 complete du referentiel et une premiere tranche de phase 2: profils locaux + roster personnel persistant, toujours exploitable sans connexion a GameTora a l'execution.

Le scope actuellement implemente est:

- `characters`
- `supports`
- `skills`
- `races`
- `racetracks`
- `g1_factors`
- `compatibility`
- `cm_targets`
- `scenarios`
- `training_events`

Les builds et l'optimisation Champions Meeting ne sont pas encore traites. La couche `legacy / parent` couvre maintenant les parents et leurs sous-parents embarques localement, mais elle ne constitue pas encore un moteur complet de build CM.

## Ce qui a ete realise

### 1. Pipeline d'import local

Un pipeline complet a ete mis en place pour:

- lire le manifest public GameTora
- resoudre les datasets JSON versionnes
- telecharger les sources brutes localement
- normaliser les donnees dans un schema stable
- construire un bundle statique local pour l'UI

Fichiers principaux:

- [`scripts/lib/gametora_reference.py`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\scripts\lib\gametora_reference.py)
- [`scripts/update_reference.py`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\scripts\update_reference.py)
- [`config/sources.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\config\sources.json)

### 2. Schema local stable

Les donnees sont separees en trois couches:

- `data/raw/`
- `data/normalized/`
- `data/runtime/`
- `dist/`

Cette separation permet de garder:

- la tracabilite des sources
- un schema stable pour les evolutions futures
- une UI decouplee des formats bruts GameTora
- une base SQLite locale prete pour la suite

### 3. Interface locale de consultation

Une interface statique locale a ete construite pour:

- choisir un profil local au demarrage
- basculer entre `My Roster` et `Catalog`
- naviguer par dataset
- rechercher
- filtrer
- consulter les fiches detail
- naviguer entre entites reliees
- afficher les dates d'import et la provenance
- modifier localement les entrees possedees dans `My Roster`

Fichiers UI:

- `src/ui/index.html`
- `src/ui/assets/app.js`
- `src/ui/assets/app.css`

### 4. Profils locaux et roster personnel

Une couche utilisateur locale a ete ajoutee via le serveur Python:

- wizard de premier demarrage si aucun profil n'existe
- page d'entree de selection de profil
- creation, selection et suppression de profils
- stockage local des profils dans `data/user/`
- stockage roster separe par profil
- `My Roster` pour les `characters`, `supports` et `legacy`
- `Catalog` pour ajouter / retirer les personnages et supports possedes
- edition locale des personnages et supports depuis `My Roster`
- mode `detail` pour l'edition fine
- mode `batch` pour la maintenance rapide du roster
- fond video local sur la page de selection de profil

API locale ajoutee:

- `GET /api/profiles`
- `POST /api/profiles`
- `POST /api/profiles/select`
- `DELETE /api/profiles/<id>`
- `GET /api/profiles/<id>/roster`
- `PUT /api/profiles/<id>/roster`
- `GET /api/profiles/<id>/roster-view/characters`
- `GET /api/profiles/<id>/roster-view/supports`
- `GET /api/profiles/<id>/legacy-view`
- `POST /api/profiles/<id>/legacy-simulator/preview`

### 5. Approfondissement du roster characters / supports

Le roster local n'est plus seulement une couche de possession simple.

Les entrees `characters` et `supports` stockent maintenant des champs reels supplementaires:

- `characters`
  - `unique_level`
  - `custom_tags`
  - `status_flags`
- `supports`
  - `custom_tags`
  - `status_flags`

Le serveur calcule aussi des projections derivees a partir de la reference et du roster:

- `characters`
  - skills d'awakening debloquees / verrouillees
  - niveaux d'awakening accessibles
  - resume de progression et etat d'unlock
- `supports`
  - cap de niveau reel selon LB
  - progression effective par rapport a la rarete
  - snapshot des effets utilisables au niveau reel
  - hint skills et event skills disponibles dans l'etat reel de la carte

Pour cela, le referentiel a ete complete avec deux familles techniques:

- `character_progression`
  - base sur `db-files/card_talent_upgrade`
- `support_progression`
  - base sur `db-files/support_card_level`

Ces donnees restent internes au moteur roster/build et ne sont pas exposees comme datasets top-level dans la navbar.

### 6. Administration locale

Une page d'administration locale a ete ajoutee pour centraliser:

- lancement des updates
- suivi du job courant
- creation et restauration de backups
- import / export / renommage / suppression des profils

Le wizard et l'admin affichent maintenant une progression plus lisible pendant la creation initiale de la base locale:

- message indiquant que l'operation peut prendre plusieurs minutes
- progression basee sur des checkpoints backend
- affichage de la tache courante en cours

### 7. Assets visuels locaux

Le projet telecharge et sert localement:

- icones de skills
- portraits de characters
- icones de supports
- illustrations de supports
- bannieres de races

Le but est d'eviter tout appel a GameTora au moment de la consultation.

### 8. Donnees relationnelles utiles pour la suite

Des liens utiles ont ete preserves dans le referentiel:

- skills d'un character: unique, innate, awakening, event
- hint skills et event skills des supports
- navigation inverse depuis un skill vers characters / supports
- `compatibility` comme entite de reference, pas comme simple outil annexe

### 9. Extension CM et scenarios

Le referentiel local integre maintenant aussi:

- `cm_targets`
  - editions Champions Meeting
  - dates
  - profil de course cible
  - liens vers `races` et `racetracks` candidates quand resolubles
- `scenarios`
  - scenarios d'entrainement
  - caps de stats
  - scenario factors
- `training_events`
  - entite agregree
  - `event_source` pour distinguer `shared`, `char`, `char_card`, `friend`, `group`, `scenario`, `sr`, `ssr`
  - liens vers characters / supports / scenarios quand disponibles
  - conservation des choix, outcomes bruts et metadonnees source pour la suite

Le choix structurel retenu est de garder `training_events` comme une seule entite de reference, avec filtrage par source, au lieu de multiplier les entites top-level.

### 10. Migration SQLite demarree

Une premiere couche SQLite locale a ete ajoutee pour la reference:

- generation de `data/runtime/reference.sqlite` pendant l'update
- schema relationnel pour les entites principales et leurs liens utiles
- conservation de `payload_json` pour ne pas perdre de detail pendant la transition
- metadonnees SQLite exposees via `__meta`
- vues techniques preparees pour le roster:
  - `roster_character_projection`
  - `roster_support_projection`

L'UI continue encore de lire le bundle statique existant (`dist/data/reference-data.js`, ~17 Mo, charge en une fois via `window.UMA_REFERENCE_DATA`) — ce point n'est pas dans le perimetre de la phase ci-dessous et reste a decider separement (voir "Ce qui reste hors perimetre" plus bas).

**Phase 1 (lectures backend) terminee.** Etat avant cette phase: cote lecture, c'etait a 0% — `serve_reference.py` n'interrogeait jamais le contenu de la base, seulement son existence (`has_reference_db`) et ses metadonnees de build via `/__meta`. Toutes les routes de donnees lisaient encore `data/normalized/*.json`.

Nouveau module `scripts/lib/sqlite_queries.py`: couche de lecture pure au-dessus de `reference.sqlite`, une connexion ouverte-puis-fermee par appel (`PRAGMA query_only = ON` en defense), jamais de connexion partagee entre threads (le serveur est un `ThreadingTCPServer`). Bascules effectuees, dans l'ordre:

- `GET /api/reference/<entity>/<id>` — lecture directe par id (`fetch_reference_item`)
- `validate_build_references` — verifications d'existence en base (`existing_ids`, `entity_has_any_rows` pour preserver la tolerance existante "pas de donnees du tout -> ne pas valider")
- `build_character_progression_lookup` / `build_support_progression_lookup`
- `normalize_roster` — lookup de rarete des supports (`fetch_support_rarity_by_id`)
- `GET /api/reference` (listing) — `fetch_entity_listing`, avec une nuance assumee: le champ `generated_at` par entite n'existe pas comme colonne dediee en SQLite (seul `imported_at`, le plus recent telechargement brut, l'est) — mappe sur `imported_at` plutot que reconstruit artificiellement
- `build_roster_view` — reecrite pour ne charger que les items possedes (`fetch_reference_items_by_id`), gain de perf reel par rapport au JSON qui chargeait toute l'entite peu importe la taille du roster
- **Nouvelle route additive** `GET /api/reference/<entity>/browse` — paginee et filtree (`fetch_browsable_entity`), parametres `filter=cle:valeur` (repetable), `q` (recherche substring sur `search_text`), `limit`/`offset` (limit plafonne a 200). S'appuie sur les vues `browse_<entity>` et la table `entity_filter_values` deja prevues dans le schema pour cet usage. C'est la piece qui delivre vraiment "performant pour une vraie app" — la route existante `/api/reference/<entity>` (dump complet) n'a pas ete touchee, voir plus bas
- `build_legacy_reference_catalogs` — le plus lourd (5 entites, dont `compatibility` keyee par `character_id` et non `id`). Changement de comportement assume: la degradation partielle par entite (un fichier JSON manquant, les autres presents) devient tout-ou-rien lie a l'existence du fichier SQLite — plus correct en principe (un seul fichier construit atomiquement vs quatre fichiers independants), verifie par un test dedie qui appelle la fonction reelle (pas le bypass `patch_catalogs()` que le reste de la suite legacy utilise expres)

**Bug trouve et corrige en cours de route**: chaque fonction de `sqlite_queries.py` accepte un `database_path` optionnel qui, par defaut, retombe sur `get_reference_database_path()` — une fonction independante du `REFERENCE_DB_PATH` de `serve_reference.py` (qui, lui, est bien sandboxe dans les tests). Les tout premiers appels ecrits sans `database_path=REFERENCE_DB_PATH` explicite lisaient donc silencieusement la vraie base du projet au lieu du sandbox de test — masque un temps par une coincidence (le personnage de test "Special Week"/id 100101 existe aussi reellement dans les vraies donnees GameTora). Detecte via un test qui attendait un 404 et a reçu 258 personnages reels. Corrige partout: chaque appel dans `serve_reference.py` passe maintenant explicitement `database_path=REFERENCE_DB_PATH`.

**Ce qui reste hors perimetre de cette phase** (assume, pas un oubli):
- `GET /api/reference/<entity>` (dump complet d'une entite, sans filtre) reste sur le chemin JSON. Le reconstruire depuis SQLite demanderait de recomposer l'enveloppe complete (`schema_version`, `generated_at`, `source`, `items`, plus des extras specifiques comme `references` pour `skills` ou `model` pour `compatibility`, stockes a part dans `reference_documents`) — travail reel pour une route que rien n'appelle en production aujourd'hui (le frontend utilise le bundle statique, pas cette route). Le dump complet reste sur JSON; la nouvelle route `/browse` couvre le vrai besoin de consultation filtree/paginee.
- La bascule du Catalog frontend vers du fetch a la demande (au lieu du blob statique 17 Mo) reste un chantier separe, plus consequent (~7400 lignes, zero pagination existante cote JS), a cadrer independamment.

### 11. Race Skill Visualizer (MVP)

Premier chantier produit livre apres plusieurs sessions consacrees a la dette
technique. Recommande depuis le debut par `docs/CM_BUILD_PLAN.md` et
`docs/EXTERNAL_SOURCES_PLAN.md`, jamais demarre avant cette session.

Nouveau module frontend `src/ui/assets/js/visualizer.js` (100% frontend,
zero changement backend), branche sur la fiche detail `racetracks`:

- vue lineaire de la piste (pas un ovale — les donnees `racetracks` sont 1D,
  aucune geometrie de courbe/(x,y) nulle part dans le pipeline), avec bandes
  virages/lignes droites/pentes et reperes de phase, rendue en SVG genere a
  la main (pas de librairie, coherent avec la philosophie "zero dependance"
  du projet)
- parseur (`parseConditionString`) des conditions d'activation de skill —
  chaines booleennes `variable OPERATOR value` jointes par `&`/`@`, **non
  echappees en HTML** (verifie directement contre les vraies donnees
  GameTora importees cette session, malgre une premiere piste erronee
  suggerant un echappement)
- matcher (`resolveStaticZones`) qui projette sur la piste les seules
  variables statiquement resolubles (`is_finalcorner`, `is_lastcorner`,
  `is_last_straight`, `is_laststraight`, `phase`, `phase_random`,
  `remain_distance`, `slope`) et relegue les variables dynamiques
  (`order`, `order_rate`, `bashin_diff_*`, `is_overtake`, etc. — dependantes
  du classement/des adversaires, non deductibles de la reference statique)
  en badges texte a cote de la zone, sans jamais fabriquer une zone non
  justifiee
- selecteur de skill par recherche, recyclant le pattern de
  `getFilteredLegacyTargetOptions` (`legacy.js`)
- deja accessible depuis `cm_targets` gratuitement (son "Related Racetracks"
  existant navigue deja vers la fiche `racetracks`); **pas encore accessible
  depuis `races`**, qui n'a aujourd'hui aucun champ `related_racetracks` —
  contrairement a `cm_targets`, `normalize_races()` ne fait pas ce matching
  cote serveur; l'ajouter est un vrai changement backend, volontairement
  hors perimetre de ce MVP

Teste dans `tests/js/test_visualizer.mjs` avec les conditions reelles de 3
skills (Certain Victory, Clear Heart, Xceleration) tirees directement de la
base SQLite importee cette session.

#### 11bis. Lisibilite des badges pour les skills "tout dynamique"

Limite connue du MVP: beaucoup de skills n'ont aucune variable statiquement
resolvable (`order`, `order_rate`, `bashin_diff_*`...), donc aucune zone
projetee sur la piste — juste une liste brute `variable==valeur` en vrac,
sans distinction AND/OR. Deux ameliorations apportees:

- `describeDynamicTermHuman` (`visualizer.js`): dictionnaire de glose lisible
  pour ~20 variables dynamiques a semantique non ambigue (`order<=5` -> "Rank
  <= 5", `bashin_diff_infront<=1` -> "<= 1 body from the horse ahead", etc.).
  Volontairement **pas exhaustif**: les variables a enumeration
  (`running_style`, `distance_type`, `weather`, `season`...) sont exclues —
  l'extraction des vraies conditions depuis `data/normalized/skills.json` a
  montre que `season` prend au moins 5 valeurs distinctes, pas les 4
  saisons attendues, preuve concrete qu'une table de mapping enum devinee
  aurait ete exactement le genre de precision fabriquee que ce projet evite
  ailleurs (memes principes que `resolveStaticZones` pour les zones). Le
  terme brut reste toujours visible en tooltip HTML natif au survol du badge.
- Regroupement AND/OR (`catalog.js`): les badges d'une meme alternative sont
  affiches dans leur propre encart (`.condition-group`), les alternatives
  separees par un connecteur "OR" visuel, au lieu d'etre aplaties en une
  seule liste ambigue qui laissait croire a des conditions simultanees.

#### 11ter. Affichage simultane de plusieurs skills

Le picker de skill passe de mono- a multi-selection (jusqu'a
`MAX_VISUALIZER_SKILLS = 6`, une palette fixe de 6 couleurs
`SKILL_HIGHLIGHT_CLASSES`):

- le SVG donne desormais a chaque skill selectionne sa propre bande
  horizontale empilee sous la bande des pentes (au lieu du seul overlay
  pleine hauteur du MVP, qui aurait rendu les zones de plusieurs skills
  illisibles des qu'elles se chevauchent); la hauteur du `viewBox` grandit
  dynamiquement avec le nombre de skills selectionnes et reste identique au
  comportement MVP quand aucun n'est selectionne
- le picker epingle en tete toutes les selections filtrees/scrollees hors
  vue (dans l'ordre de selection, pour une couleur stable), se grise et se
  desactive (`disabled` natif) une fois le plafond de 6 atteint, avec un
  message explicite plutot qu'un clic silencieusement ignore
- chaque skill selectionne a sa propre carte de resultat (compteur de zones,
  badges AND/OR, bouton "x" de retrait qui reutilise le meme mecanisme
  `data-skill-pick` que le picker)
- bug attrape et corrige pendant la verification navigateur: la classe
  partagee `.track-skill-N` peignait un fond plein sur les etiquettes du
  legend/des cartes (texte illisible, couleur sur couleur) — corrige en
  limitant `.track-skill-N` a `fill`/`stroke` (usage SVG) et en donnant au
  pastille de legende sa couleur via une regle dediee
  `.legend-swatch.track-skill-N::before`.

## Choix techniques et justification

### Manifest + JSON versionnes plutot que scraping HTML

Choix:

- s'appuyer sur le manifest GameTora et les datasets JSON versionnes

Pourquoi:

- beaucoup plus robuste qu'un parsing du DOM
- moins sensible aux changements de layout
- plus simple a mettre a jour
- permet une detection de changement par hash

### Separation `raw -> normalized -> served`

Choix:

- conserver la source brute, la normalisation et les donnees servies dans trois couches distinctes

Pourquoi:

- facilite le debug
- protege l'UI des changements de schema GameTora
- prepare proprement les futures phases roster / builds

### UI statique locale

Choix:

- UI simple en `HTML/CSS/JavaScript`, servie localement depuis `dist/`

Pourquoi:

- demarrage immediate
- pas de backend a maintenir
- consultation multi-OS
- maintenance plus simple qu'une stack plus lourde

Ajouts recents:

- wizard modalise pour le premier demarrage
- page d'administration locale
- favicon `URM`
- progression d'update rendue plus explicite pour les longues operations
- nouveaux datasets visibles immediatement dans la navbar:
  - `CM Targets`
  - `Scenarios`
  - `Training Events`

### Assets caches localement

Choix:

- telecharger les visuels pendant l'update

Pourquoi:

- consultation offline
- rendu plus stable
- pas de dependance reseau a l'execution
- utile pour enrichir l'UI sans coupler l'app a GameTora

### `compatibility` integree au referentiel

Choix:

- modeliser `compatibility` comme une vraie entite locale exploitable

Pourquoi:

- necessaire pour les futures phases inheritance / legacy
- permet de conserver les groupes de relation
- prepare l'exploitation des G1 factors sans figer trop tot une formule finale

### Brique `Legacy / Parent` dans `My Roster`

Etat:

- nouvelle vue `Legacy` dans `My Roster`
- inventaire local de parents par profil dans `data/user/profiles/<profile_id>/legacy.json`
- CRUD local complet sur les fiches parents
- saisie assistee des sparks
- modele parent realigne sur le fonctionnement reel:
  - `1` blue spark
  - `1` pink spark
  - `0 ou 1` green spark unique
  - `0..n` white sparks
- chaque parent embarque maintenant ses `2` grands-parents locaux
- simulateur d'heritage v2 base sur:
  - le roster `characters` possede
  - deux parents issus de l'inventaire local
  - quatre sous-parents derives des fiches parent
  - `compatibility`
  - `g1_factors`
  - `scenarios`

Choix:

- une seule fiche `legacy` porte a la fois les infos de run source et de parent reutilisable
- pas de separation `run_result` / `parent`
- les sous-parents sont stockes en embarque local dans chaque fiche parent, sans recursion supplementaire
- simulateur deterministe et explicable, pas encore stochastique
- UI `legacy` avec edition plus guidee, sections grands-parents et choix visuel des parents / sous-parents dans le simulateur

### Python pour le pipeline d'update

Choix:

- pipeline d'import implemente en Python standard library

Pourquoi:

- cross-OS sans changer la philosophie du projet
- bon support pour le telechargement, JSON et la generation de fichiers
- suffisant pour une phase 1 locale sans ajouter de dependances externes
- SQLite disponible via `sqlite3` sans service externe

Limite connue:

- Python doit etre disponible localement pour executer l'update
- la consultation locale reste portable
- un portage futur vers Node.js / Deno / Go reste envisageable si une distribution sans runtime devient prioritaire

## Etat actuel

Le referentiel est aujourd'hui fonctionnel de bout en bout:

- import
- normalisation
- sync des assets
- bundle statique
- consultation locale
- selection de profil
- navigation `My Roster` / `Catalog`
- persistance du roster personnel
- consultation via le serveur Python local recommandee pour eviter les limites `file://` et exposer l'API profils / roster

La commande de mise a jour validee est:

```bash
python ./scripts/update_reference.py
```

La commande recommandee pour consulter l'application localement est:

```bash
python ./scripts/serve_reference.py --open
```

Une variante pratique permet de mettre a jour puis servir en une seule commande:

```bash
python ./scripts/serve_reference.py --update-first --open
```

Le depot Git est prevu pour ne pas embarquer les donnees importees depuis GameTora:

- `data/raw/`
- `data/normalized/`
- `data/user/`
- `dist/data/`
- `dist/media/`

Apres clonage, un import local est donc necessaire pour regenerer les donnees et assets.

## Ce qui n'a pas encore ete traite

- comparaison / scoring
- logique de builds
- parents personnels
- heuristiques Champions Meeting
- decodage semantique fin des outcomes de `training_events`
- brique `Meta / Insights`
- `Visualizers`: `Race Skill Visualizer` livre sur `racetracks` (voir section
  11 et 11bis/11ter) avec badges lisibles et affichage simultane de
  jusqu'a 6 skills. Reste ouvert, aucune decision prise: ergonomie
  mobile/petit ecran du SVG, comparaison de decks, et extension a `races`
  (toujours pas de lien `related_racetracks` cote donnees — `normalize_races()`
  ne fait pas ce matching, contrairement a `normalize_cm_targets()`)

## Sources externes preparees

Une etude de sources externes complementaires a GameTora a ete menee pour renforcer le projet avant le moteur de build:

- `alpha123 / uma-tools`
  - retenu comme base de cadrage pour une future brique `Visualizers`
  - cible prioritaire: visualisation des skills sur `races`, puis `cm_targets`
- `uma.moe`
  - retenu comme source potentielle pour une future brique `Meta / Insights`
  - cible: statistiques, tierlists et signaux meta, stockes en snapshots locaux
- `umamoe-backend`
  - retenu surtout comme inspiration d'architecture pour la recherche `legacy` / inheritance et, plus tard, l'aide aux builds

Choix structurants:

- ne pas integrer ces sources dans le coeur de `reference`
- ne pas dependre d'elles a l'execution de l'UI
- commencer par `Visualizers`, puis seulement ensuite `Meta / Insights`
- documenter explicitement:
  - la prudence a avoir face a la licence `GPL-3.0-or-later` de `uma-tools`
  - la faisabilite d'un visualizer maison
  - l'estimation de charge pour un MVP puis une version orientee build

Le cadrage dedie est dans:

- `docs/EXTERNAL_SOURCES_PLAN.md`

## Prochaine etape logique

La suite naturelle est maintenant d'enrichir la phase 2 et de preparer la phase builds:

- approfondir le simulateur `legacy` au-dela de la projection deterministe actuelle
- poser la brique `Visualizers` pour les `races` et `cm_targets`
- exploiter `cm_targets` et `scenarios` comme vraies cibles de planification
- introduire les objets `builds` et les evaluations de faisabilite
- conserver la separation stricte entre reference globale et donnees utilisateur
- preparer une future couche `Meta / Insights` separee du referentiel canonique
- preparer ensuite les croisements necessaires a la phase builds / CM

Un cadrage dedie a la future couche `builds / Champions Meeting` est disponible dans:

- `docs/CM_BUILD_PLAN.md`
- `docs/EXTERNAL_SOURCES_PLAN.md`

## Filet de tests

Le projet n'avait jusqu'ici aucun test. Une premiere suite a ete ajoutee dans `tests/` (stdlib `unittest`, zero dependance ajoutee) pour couvrir la logique la plus fragile et non triviale du serveur local:

- calculs de progression `characters` / `supports` (`summarize_character_progression`, `summarize_support_progression`, `resolve_support_effect_value`, `get_support_curve_progress`, `get_support_level_cap`)
- normalisation des sparks `legacy` (blue / pink / green / white) et des facteurs (`normalize_legacy_factor`, `dedupe_legacy_factors`, `character_supports_green_spark`)
- compatibilite de paire (`build_pair_compatibility`)
- validation du roster et des `builds` (`normalize_roster_entry`, `normalize_build_stats`, `normalize_build_aptitudes`, `normalize_build_id_list`, `normalize_build_legacy_pair`)
- generation d'identifiants sequentiels (`next_build_id`, `next_legacy_id`, `next_profile_id`) et de noms de profil uniques
- categorisation des distances de course (`scripts/lib/gametora_reference.py`)
- normalisation `characters` et `supports` (`normalize_characters`, `normalize_supports`): forme des items, aptitudes/grades, degradation propre quand un `base_character_id` n'a pas de fiche de base, et la regression exacte du bug `hint_others` groupes
- `build_legacy_view` et `build_legacy_simulator_preview` (`tests/test_legacy_view.py`): orchestration I/O testee en isolant `PROFILE_DATA_ROOT`/`USER_DATA_ROOT`/`NORMALIZED_ROOT` dans un dossier temporaire et en monkeypatchant `build_legacy_reference_catalogs()` pour renvoyer un catalogue fixe (meme approche que `make_catalogs()` utilise deja pour les fonctions pures) — vue vide, fallback quand les catalogues sont indisponibles, item peuple avec badges de lineage/scenario, et les validations du simulateur (ids requis, meme parent deux fois, personnage principal non possede, parent inconnu, score de compatibilite calcule sur un fixture connu)
- l'entree/sortie HTTP de `ReferenceRequestHandler` (`tests/test_http_handler.py`): tests de bout en bout sur un vrai serveur `ThreadingTCPServer` lance sur un port ephemere, couvrant les flux CRUD profils / roster / legacy / builds
- les jobs d'admin et les backups (`tests/test_http_admin_routes.py`): jobs `update`/`backup` asynchrones (`start_admin_job`, executes sur un thread daemon, avec `ACTIVE_ADMIN_JOB`/`ADMIN_JOB_HISTORY` comme etat global process — chaque test reinitialise cet etat et attend explicitement la fin du job avant de conclure), conflit `409` quand un job est deja en cours, creation/liste/suppression/restauration de backups sur une vraie archive zip. Le job `update` reel appelle `update_umamusume_reference()` qui a besoin du reseau (import GameTora complet); chaque test le monkeypatch avec un faux resume rapide pour rester hors-ligne et instantane. `create_full_backup()`/`restore_full_backup()` reconstruisent plusieurs chemins (`data/runtime`, `data/raw`, `data/normalized`, `data/user`) a partir de la constante `PROJECT_ROOT` brute plutot que des globals surchargeables `USER_DATA_ROOT`/`NORMALIZED_ROOT` utilises ailleurs, et `restore_full_backup()` fait un `rmtree` sur ces chemins — `LiveServerTestCase` (`tests/test_http_handler.py`) sandbox donc aussi `PROJECT_ROOT`/`DIST_ROOT`, pas seulement `USER_DATA_ROOT`, pour qu'aucun test ne puisse toucher au vrai dossier du projet
- l'export/import de profils (`tests/test_http_profile_transfer.py`): aller-retour complet export -> import comme nouveau profil (roster preserve), gestion de collision de nom (`unique_profile_name`, suffixe `(imported)` puis `(imported) 2`), import cible sur un profil existant (ecrase son roster), et les rejets (archive non-zip, mauvais `manifest.kind`, nom de profil manquant, membre requis absent, membres `legacy.json`/`builds.json` optionnels avec defaut vide)
- les routes de reference/bootstrap en lecture seule (`tests/test_http_reference_routes.py`): `/api/reference` (listing, 404 avant tout import, comptage par entite, exclusion de `reference-meta.json`), `/api/reference/<entity>` et `/api/reference/<entity>/<id>` (404 entite/item inconnu, 500 sur payload non-objet), `/api/app/bootstrap-status` (les 3 valeurs de `recommended_entry` selon l'etat profils/reference), `/__meta`, `/api/profiles/<id>/roster-view/<characters|supports>` (projection derivee filtree aux items possedes). A note en ecrivant ces tests: `REFERENCE_META_PATH`/`REFERENCE_DB_PATH` dans `serve_reference.py` sont calcules une seule fois a l'import (`DIST_ROOT / "data" / "reference-meta.json"` et `get_reference_database_path()`), donc patcher `DIST_ROOT`/`PROJECT_ROOT` seuls ne les deplace pas — `LiveServerTestCase` patche maintenant aussi ces deux constantes explicitement, sinon `/__meta` et `bootstrap-status` auraient lu les vraies donnees GameTora de ce projet au lieu du sandbox

- les 11 fonctions `normalize_X` de `scripts/lib/gametora_reference.py` restant a couvrir apres `normalize_characters`/`normalize_supports` (`tests/test_gametora_reference.py`): `normalize_training_event_choices`, `normalize_character_progression`, `normalize_support_progression`, `normalize_skills`, `normalize_races`, `normalize_racetracks`, `normalize_g1_factors`, `normalize_compatibility`, `normalize_cm_targets`, `normalize_scenarios`, `normalize_training_events`. Ce sont les fonctions qui transforment les donnees brutes GameTora en schema stable — le coeur du pipeline d'import, jusque-la jamais protegees contre une regression silencieuse pour 11 entites sur 13. En ecrivant ces tests, une vraie regression a ete trouvee et corrigee dans `normalize_races`: le champ `banner_id` appelait `int(race["banner_id"])` sans garde nulle alors que la construction de l'asset banner juste en dessous verifiait deja explicitement `race.get("banner_id") is not None` — une race sans banniere (cas reel et anticipe par le code lui-meme) faisait planter toute la fonction avec un `TypeError`. Fixe et regression pinnee par un test dedie.
- `scripts/lib/sqlite_reference.py` (2158 lignes, 0 test avant cette passe): les ~10 petites fonctions pures (`as_array`, `coalesce`, `encode_json`, `join_search_text`, `convert_display_label(_list)`, `get_asset_entries`, `ensure_directory`, `bool_int`, `availability_int`, `score_band_for_value`) dans `tests/test_sqlite_reference.py`, plus une vraie integration de bout en bout de `build_reference_database()` dans `tests/test_sqlite_reference_build.py`: construit un `normalized` reel en rejouant les memes fonctions `normalize_X` que le pipeline reel (memes fixtures que `tests/test_gametora_reference.py`), ecrit une vraie base SQLite sur un chemin temporaire, puis verifie que les lignes sont bien presentes (`SELECT COUNT(*) FROM characters`), que `read_reference_database_meta()` relit correctement le resume de build, et qu'un rebuild remplace la base au lieu d'empiler les lignes. C'est le premier test qui exerce le pipeline complet normalize -> SQLite -> lecture; jusque-la, tout le code d'ecriture (`_insert_*`, ~1300 lignes) tournait en production sans qu'aucune requete ne verifie jamais que les donnees inserees etaient correctes.
- `scripts/lib/sqlite_queries.py` (`tests/test_sqlite_queries.py`, nouveau module de lecture SQLite, voir section 10 plus haut): chaque helper (`fetch_reference_item`, `existing_ids`, `entity_has_any_rows`, les lookups de progression, `fetch_entity_listing`, `fetch_reference_items_by_id`, `fetch_browsable_entity`, `fetch_all_reference_items`, `fetch_compatibility_by_character_id`) teste directement contre une vraie base SQLite temporaire construite via `build_minimal_normalized_reference()`. Les tests HTTP correspondants (`tests/test_http_reference_routes.py`, `tests/test_legacy_view.py::BuildLegacyReferenceCatalogsFromSqliteTests`) ont ete convertis pour construire une vraie base SQLite au lieu d'ecrire des fichiers JSON, la ou leur route a bascule.

Toutes les familles de routes du handler HTTP sont couvertes: profils, roster, legacy, builds, jobs d'admin, backups, export/import, reference/bootstrap.

Lancer la suite:

```bash
python -m unittest discover -s tests -t . -v
```

Elle tourne aussi automatiquement sur chaque push / pull request via `.github/workflows/tests.yml`.

Ce filet couvre maintenant les fonctions pures les plus critiques (y compris les 13 `normalize_X` du pipeline d'import), l'orchestration `legacy`, le handler HTTP dans son integralite, les jobs d'admin/backups, et l'ecriture SQLite de bout en bout. Ce qui reste a couvrir en priorite: les fonctions de rendu HTML (`renderXxx`) et l'orchestration DOM/fetch cote JS (attendraient plutot des tests d'integration type Playwright), et, si la bascule des lectures vers SQLite demarre un jour, les requetes de lecture qui en decouleront.

Cote frontend, une suite existe aussi dans `tests/js/` (stdlib `node:test` + `node:assert/strict`, zero dependance ajoutee, meme philosophie que le cote Python). `tests/js/_domshim.mjs` pose un `document`/`window` minimal pour que `src/ui/assets/js/core.js` (qui interroge des elements DOM au chargement du module) soit importable sous Node tout court — et par ricochet, tous les modules qui l'importent (directement ou via `../app.js`, dependance circulaire volontaire deja documentee plus haut). Couverture actuelle (109 tests / 233 assertions, un fichier de test par module source):

- `dom-utils.js`: `escapeHtml`, `hashText`, `badgePalette`, `clampRatio`, `clampNumber`, `parseRosterTokenList`, `tableFromRows`
- `core.js`: `asArray`, `normalizeProfilesIndex`, `normalizeRosterDocument`, `normalizeBuildEntry`, `normalizeBuildsDocument`, `getSupportLevelCap`, `hasFilterOption`, `defaultEntityKeyForMode`, `allowedEntityKeys`, `currentRouteState`
- `catalog.js`: `formatSupportEffectValue`, `formatTrainingEventChoiceLabel`
- `roster.js`: `getCharacterProgressSummary`, `getSupportProgressSummary`, `getDefaultRosterEntry`, `pruneRosterEntry`, `getRosterBadges`
- `builds.js`: `getBuildEditorKey`, `getAptitudeTone`, `getAptitudeHint`, `getCharacterAptitudeForTarget`, `getBuildTargetProfile`, `getLegacySparkSummaryText`, `legacyMatchesBuildTarget`, `createEmptyBuildEntry`
- `legacy.js`: `getCharacterBaseRarity`, `getCharacterRosterDefaults`, `getCharacterUniqueSkill`, `characterSupportsGreenSpark`, `getLegacyScenarioLabel`, `formatLegacyFactorLabel`, `deriveLegacyWhiteSparks`
- `admin.js`: `wizardNeedsReferenceBuild`, `getWizardProgress`, `getTimedProgress`, `getUpdateProgress`
- `visualizer.js` (Race Skill Visualizer, voir section 11/11bis/11ter): `parseConditionString`, `resolveStaticZones`, `describeDynamicTermHuman`, `buildTrackSvg` (dont le comportement multi-groupes/multi-couleurs), `getFilteredSkillPickerOptions` (multi-selection, epinglage dans l'ordre de selection)

Lancer la suite (Node 22 installe et verifie dans cet environnement de dev; sur Windows, utiliser explicitement le glob, la forme repertoire seule echoue avec `ERR_MODULE_NOT_FOUND` — voir `CLAUDE.md`):

```bash
node --test tests/js/*.mjs
```

Cette suite couvre les fonctions pures les plus faciles a isoler par module (parsing, formatage, calculs de ratio, agregation), en suivant le meme principe pur/I-O que `docs/REFACTOR_PLAN.md` applique cote Python — y compris pour des fonctions qui lisent `state`/`data` (les singletons mutables de `core.js`), en initialisant ces objets avant chaque assertion plutot qu'en les considerant hors de portee. Les fonctions de rendu HTML pur (`renderXxx`) et l'orchestration DOM/fetch restent hors de portee des tests unitaires et attendraient plutot des tests d'integration type Playwright, deja evoques dans `docs/REFACTOR_PLAN.md`.

## Refactor serve_reference.py / app.js

Les deux monolithes signales plus haut ont ete decoupes en suivant `docs/REFACTOR_PLAN.md`:

- `scripts/serve_reference.py`: 3310 -> 2214 lignes. Logique pure extraite dans `scripts/lib/common.py`, `legacy_factors.py`, `roster_progression.py`, `builds_validation.py`, `profiles.py`. L'orchestration I/O et le handler HTTP restent dans `serve_reference.py`.
- `src/ui/assets/app.js`: 7318 -> 1401 lignes, servi en `<script type="module">`. Decoupe en `src/ui/assets/js/core.js`, `dom-utils.js`, `catalog.js`, `roster.js`, `legacy.js`, `builds.js`, `admin.js`.

Statut et limites detaillees dans `docs/REFACTOR_PLAN.md`. A retenir pour la suite:

- `src/ui/assets/js/` a maintenant un premier filet (`tests/js/`, voir section precedente) qui couvre les fonctions pures de chacun des 7 modules, `catalog.js`/`roster.js`/`legacy.js`/`builds.js`/`admin.js` inclus. Seules les fonctions de rendu HTML (`renderXxx`) et l'orchestration DOM/fetch restent non couvertes.
- Le decoupage en modules ES a introduit une dependance cyclique volontaire entre `core.js` et `app.js`; le cablage des event listeners en fin de `app.js` doit rester dans `boot()` (differe via `queueMicrotask`), pas au top-level du fichier — voir le commentaire au-dessus de `function boot()`.

## Outillage qualite

- Tests: voir "Filet de tests" plus haut (Python: `python -m unittest discover -s tests -t . -v`; JS: `node --test tests/js/`).
- Lint Python: `pyproject.toml` configure `ruff` (regles `E`/`F`, `E501` ignore volontairement — le style du projet privilegie des lignes longues et plates plutot que le wrapping). Job CI `lint` dans `.github/workflows/tests.yml`, bloquant. Verifie initialement en recuperant le binaire `ruff` directement (l'environnement de dev de l'epoque n'avait pas de Python installe du tout, donc pas de `pip`) — 26 imports inutilises trouves au premier run, tous des restes du refactor `serve_reference.py` (re-export en masse vers `scripts/lib/`). Corriges: les imports genuinement morts ont ete retires, et `tests/test_serve_reference.py` importe maintenant directement depuis `lib.common` / `lib.legacy_factors` / `lib.roster_progression` au lieu de passer par `sr.X` pour les fonctions qui n'etaient re-exportees que pour les tests. Un environnement de dev plus recent a un vrai Python 3.12 + pip installes (`pip install ruff` fonctionne directement). `ruff check .` est propre.
- Pas de linter JS pour l'instant (Node est desormais installe et verifie dans au moins un environnement de dev, mais aucun linter JS n'a encore ete mis en place/configure).
- **`mypy` teste et ecarte pour l'instant.** Assemble manuellement sans `pip` (wheels `mypy`/`typing_extensions`/`mypy_extensions`/`tomli` extraites a la main) pour verifier avant d'ajouter quoi que ce soit a la CI. Verdict: pas pratique tel quel sur ce code. `scripts/lib/gametora_reference.py` (3266 lignes) ne termine pas l'analyse en 90s pour un seul fichier, `scripts/serve_reference.py` non plus en 30s — tres probablement du a l'inference de mypy sur les tres gros litteraux `OrderedDict([...])` imbriques et le typage `Any` massif utilises partout dans ces deux fichiers. Les petits modules de `scripts/lib/` (`common.py`, `roster_progression.py`, `builds_validation.py`, `profiles.py`) passent instantanement. `legacy_factors.py` a remonte une vraie piste avant d'etre interrompu: `migrate_legacy_sparks_from_factors(raw_factors: object, ...)` (ligne 321) type son parametre en `object` alors que le corps l'itere (`for raw_factor in (raw_factors or [])`), ce qui ne serait pas garanti par ce type — pas corrige, note ici pour eviter de re-decouvrir la meme chose. Ne pas reessayer mypy sans d'abord cibler `--follow-imports=silent` par fichier ou refactorer ces litteraux, sinon meme conclusion.
