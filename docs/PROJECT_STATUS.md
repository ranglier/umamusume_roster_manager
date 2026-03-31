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

L'UI continue encore de lire le bundle statique existant; la bascule des lectures vers SQLite sera la tranche suivante.

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
- briques `Visualizers` et `Meta / Insights`

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
