# Umamusume Roster Manager

Referentiel local et roster manager pour `Umamusume Pretty Derby`, alimente depuis GameTora, stocke localement, consultable hors ligne et mettable a jour via une commande dediee.

Le projet couvre aujourd'hui:

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
- profils locaux
- wizard de premier demarrage
- roster personnel local pour `characters` et `supports`
- inventaire local `legacy / parents`
- simulateur d'heritage local v1
- administration locale

Hors perimetre a ce stade:

- builds
- recommandations Champions Meeting
- scoring / optimisation

## Vue d'ensemble

Le projet suit une separation simple et stable:

- `data/raw/`: sources GameTora telechargees telles quelles
- `data/normalized/`: schema local stable
- `data/runtime/`: base SQLite locale de reference
- `dist/`: application statique et donnees servies localement

L'application ne depend pas de GameTora a l'execution. Tout est importe puis consulte localement.

Important pour le depot Git:

- les donnees importees depuis GameTora ne sont pas versionnees
- les schemas normalises locaux ne sont pas versionnes
- les assets telecharges localement ne sont pas versionnes

Apres clonage, il faut donc relancer un import local avant usage.

## Strategie d'extraction

Le projet ne scrape pas le HTML visuel de GameTora.

Strategie retenue:

1. lecture du manifest public `https://gametora.com/data/manifests/umamusume.json`
2. resolution des datasets JSON versionnes
3. telechargement des sources utiles depuis `https://gametora.com/data/umamusume/...`
4. normalisation vers un schema local stable
5. materialisation d'une base SQLite locale
6. construction d'un bundle statique local

Pourquoi:

- plus robuste qu'un parsing DOM
- decouple de la structure visuelle du site
- detection simple des changements par hash
- facilite la conservation locale des sources

## Architecture

```text
Umamusume_Roster_Manager/
|- config/
|  `- sources.json
|- data/
|  |- raw/
|  |- normalized/
|  |- runtime/
|  `- user/
|  `- ...
|- dist/
|  |- index.html
|  |- assets/
|  |- data/
|  `- media/
|- scripts/
|  |- update_reference.py
|  |- serve_reference.py
|  `- lib/
|     |- gametora_reference.py
|     `- sqlite_reference.py
`- src/
   `- ui/
      |- index.html
      `- assets/
         |- app.css
         `- app.js
         `- profile-selection-bg.mp4
```

Principes:

- pipeline `raw -> normalized -> served`
- migration runtime en cours vers SQLite
- UI statique locale
- assets visuels caches localement
- `compatibility` traitee comme une vraie entite de referentiel

## Sources integrees

Pages fonctionnelles:

- `https://gametora.com/umamusume/characters`
- `https://gametora.com/umamusume/supports`
- `https://gametora.com/umamusume/skills`
- `https://gametora.com/umamusume/races`
- `https://gametora.com/umamusume/racetracks`
- `https://gametora.com/umamusume/g1-race-factor-list`
- `https://gametora.com/umamusume/compatibility`

Datasets reels consommes:

- `characters`
- `character-cards`
- `support-cards`
- `support_effects`
- `skills`
- `static/skill_effect_values`
- `static/skill_condition_values`
- `races`
- `racetracks`
- `factors`
- `events/champions-meeting`
- `scenarios`
- `static/scenarios`
- `static/scenario_factors`
- `training_events/shared`
- `training_events/char`
- `training_events/char_card`
- `training_events/friend`
- `training_events/group`
- `training_events/scenario`
- `training_events/sr`
- `training_events/ssr`
- `dict/te_pairs_en`
- `db-files/support_card_level`
- `db-files/card_talent_upgrade`
- `db-files/succession_relation`
- `db-files/succession_relation_member`

## Assets visuels

Les visuels utiles sont telecharges localement pendant l'update puis servis depuis `dist/media/reference/`.

Assets pris en charge:

- icones de `skills`
- portraits de `characters`
- icones de `supports`
- illustrations de `supports`
- bannieres de `races`
- fond video local de la page de selection de profil

La consultation ne depend donc pas du reseau.

## Commandes

Mettre a jour le referentiel:

```bash
python ./scripts/update_reference.py
```

Forcer un refresh complet:

```bash
python ./scripts/update_reference.py --force
```

Notes:

- Windows: `py -3 .\scripts\update_reference.py` fonctionne aussi
- macOS / Linux: `python3 ./scripts/update_reference.py` fonctionne aussi si `python` n'est pas disponible

Ouvrir l'application locale:

- recommande: servir `dist/` en HTTP local pour eviter les limites `file://` de certains navigateurs

```bash
python ./scripts/serve_reference.py --open
```

- variante pratique pour regenerer puis servir dans la foulee:

```bash
python ./scripts/serve_reference.py --update-first --open
```

- URL locale: `http://127.0.0.1:8000/`
- endpoint sante: `http://127.0.0.1:8000/__health`
- endpoint metadata: `http://127.0.0.1:8000/__meta`
- endpoint profils: `http://127.0.0.1:8000/api/profiles`
- l'application ouvre sur un selecteur de profil
- apres selection, la vue par defaut est `My Roster / Characters`
- `My Roster` couvre `characters`, `supports` et `legacy`
- `Catalog` permet d'explorer les datasets et d'ajouter / retirer les `characters` et `supports` possedes
- le serveur Python local est le mode officiel en phase 2, car il expose aussi l'API profils / roster
- l'ouverture directe de `dist/index.html` ou un simple serveur statique ne couvre pas les profils ni l'edition du roster

Apres un clonage neuf, commencer par lancer l'update pour regenerer `data/` et les assets locaux.

## Donnees normalisees

Fichiers principaux:

- [`data/normalized/characters.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\characters.json)
- [`data/normalized/supports.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\supports.json)
- [`data/normalized/skills.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\skills.json)
- [`data/normalized/races.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\races.json)
- [`data/normalized/racetracks.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\racetracks.json)
- [`data/normalized/g1_factors.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\g1_factors.json)
- [`data/normalized/compatibility.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\compatibility.json)
- [`data/normalized/cm_targets.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\cm_targets.json)
- [`data/normalized/scenarios.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\scenarios.json)
- [`data/normalized/training_events.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\training_events.json)
- [`data/normalized/reference-meta.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\reference-meta.json)
- `data/runtime/reference.sqlite`

Resume du modele:

- `characters`: variantes, aptitudes, bonus de stats, stats, profil, liens de skills
- `supports`: type, rarete, effets, unique effects, hint skills, event skills, stat gain
- `skills`: rarete, cout, activation, tags, descriptions, conditions
- `races`: hippodrome, surface, distance, direction, saison, grade, liens facteurs
- `racetracks`: geometrie de piste, phases, pentes, longueurs, layout
- `g1_factors`: facteurs G1 et courses associees
- `compatibility`: groupes de relation et top matches pour l'inheritance futur
- `cm_targets`: editions Champions Meeting, profil de course cible, dates, liens vers races / racetracks candidates
- `scenarios`: scenarios d'entrainement, caps de stats et scenario factors
- `training_events`: events d'entrainement agreges avec `event_source`, liens vers characters / supports / scenarios et conservation du brut
- `character_progression`: paliers d'awakening et skills de progression des characters
- `support_progression`: courbes de progression des supports par rarete / niveau

Note runtime:

- `reference.sqlite` est reconstruit a chaque update
- il prepare la migration des lectures UI / API vers des requetes locales plus fines
- l'UI actuelle continue encore d'utiliser le bundle `dist/data/reference-data.js` pendant la transition

## Interface locale

L'UI locale permet:

- wizard de premier demarrage si aucun profil n'existe
- selection de profil
- `My Roster` pour les `characters` / `supports` possedes et les parents `legacy`
- `Catalog` pour parcourir la reference et alimenter le roster
- `Administration` pour les updates, backups et profils
- navigation par dataset
- navigation par `CM Targets`, `Scenarios` et `Training Events`
- mode roster `detail` et mode roster `batch`
- mode `Legacy / Parents`
- mode `Legacy / Simulator`
- recherche texte
- filtres
- consultation detaillee
- affichage des visuels locaux
- navigation croisee entre entites
- edition locale des entrees possedees
- edition inline par lot pour `characters` et `supports`
- affichage de la source et de la date d'import locale

Pendant la creation initiale de la base locale:

- une barre de progression est affichee
- la tache courante est visible
- certaines etapes peuvent prendre plusieurs minutes, surtout la synchronisation des assets

Le roster personnel stocke maintenant aussi des champs locaux d'organisation et de progression:

- `characters`
  - `owned`
  - `favorite`
  - `note`
  - `stars`
  - `awakening`
  - `unique_level`
  - `custom_tags`
  - `status_flags`
- `supports`
  - `owned`
  - `favorite`
  - `note`
  - `level`
  - `limit_break`
  - `custom_tags`
  - `status_flags`
- `legacy`
- structure des parents alignee sur le fonctionnement reel:
  - `1` blue spark
  - `1` pink spark
  - `0 ou 1` green spark unique
  - `0..n` white sparks
  - `character_card_id`
  - `base_character_id`
  - `scenario_id`
  - `scenario_name`
  - `source_date`
  - `source_note`
  - `stars`
  - `awakening`
  - `custom_tags`
  - `status_flags`
  - `blue_spark`
  - `pink_spark`
  - `green_spark`
  - `white_sparks[]`

Le serveur expose en plus des projections enrichies, fusionnant roster + reference:

- `GET /api/profiles/<id>/roster-view/characters`
- `GET /api/profiles/<id>/roster-view/supports`
- `GET /api/profiles/<id>/legacy-view`
- `POST /api/profiles/<id>/legacy-simulator/preview`

Ces projections servent a afficher localement:

- les skills d'awakening actuellement debloquees / verrouillees
- un resume de progression des characters
- les valeurs effectives d'une support a son niveau / LB reels
- les hint skills / event skills disponibles dans l'etat reel de la carte
- les parents sauvegardes avec leurs facteurs normalises
- les sparks parents structurees (`blue`, `pink`, `green`, `white`)
- des sous-parents / grands-parents embarques localement dans chaque parent
- une preview deterministe d'heritage basee sur `compatibility`, `g1_factors`, les scenarios locaux et la structure complete `main + 2 parents + 4 sous-parents`
- des filtres roster derives utilisables en UI
- un editeur `legacy` assiste avec selection structuree des sparks
- un simulateur `legacy` avec choix visuel des parents sauvegardes, slots de sous-parents derives et preview orientee synthese

L'UI source est dans:

- `src/ui/index.html`
- `src/ui/assets/app.js`
- `src/ui/assets/app.css`

Le bundle servi localement est dans:

- `dist/index.html`
- `dist/assets/app.js`
- `dist/assets/app.css`
- `dist/assets/favicon.svg`
- `dist/data/reference-data.js`

Note:

- `dist/data/` et `dist/media/` sont regeneres localement et exclus du versioning Git

## Fichiers clefs

- configuration des sources: `config/sources.json`
- pipeline import / normalisation / build: `scripts/lib/gametora_reference.py`
- materialisation SQLite locale: `scripts/lib/sqlite_reference.py`
- commande d'update: `scripts/update_reference.py`
- serveur local de consultation: `scripts/serve_reference.py`
- UI source: `src/ui/index.html`, `src/ui/assets/app.js`, `src/ui/assets/app.css`
- metadonnees raw: `data/raw/metadata.json`
- catalogue assets: `data/raw/assets/metadata.json`

## Hypotheses et limites

- GameTora doit continuer d'exposer son manifest public et ses datasets JSON versionnes.
- `compatibility` est conservee comme base de calcul, sans integration directe des bonus G1 dans un score compose.
- le roster personnel reste local, sans sync cloud ni multi-utilisateur
- l'updater repose sur Python standard library pour rester cross-OS sans dependances externes
- SQLite est utilise via `sqlite3` standard library, sans service externe ni ORM
- la consultation locale est recommandee via HTTP local pour rester cross-navigateur
- le depot Git ne contient pas les donnees GameTora importees; elles doivent etre regenerees localement
- la creation initiale de la base locale peut etre longue a froid, surtout lors du telechargement des assets
- `training_events` reste volontairement conservateur: les choix et outcomes sont preserves et relies, mais leur semantique fine n'est pas encore completement decodee pour du scoring
- le simulateur `legacy` reste une projection deterministe explicable; il ne couvre pas encore les calculs probabilistes complets d'heritage
- la couche `legacy` couvre maintenant les sous-parents / grands-parents, mais pas encore les probabilites detaillees d'inheritance ni les moteurs de recommandation
- les futures briques `Visualizers` et `Meta / Insights` devront rester separees du coeur de reference; elles sont cadrees mais pas encore implementees

## Sources externes et briques futures

Des sources externes complementaires a GameTora ont ete etudiees pour renforcer l'application avant le moteur de build:

- `alpha123 / uma-tools`
  - cible: brique `Visualizers`
  - usage pressenti: visualisation locale des zones d'activation de skills sur `races`, puis `cm_targets`, puis futurs `builds`
- `uma.moe`
  - cible: brique `Meta / Insights`
  - usage pressenti: snapshots meta, tierlists, statistiques et signaux d'aide pour les futurs builds
- `umamoe-backend`
  - cible: inspiration d'architecture pour la recherche `legacy` / inheritance et la future recherche de builds

Choix retenu:

- ne pas melanger ces briques au referentiel canonique
- ne pas creer de dependance runtime directe a ces sites
- commencer par `Visualizers`, puis seulement ensuite `Meta / Insights`
- la doc dediee precise aussi:
  - pourquoi la licence `GPL-3.0-or-later` de `uma-tools` impose de privilegier une reimplementation locale
  - pourquoi un visualizer maison est faisable
  - quelle charge approximative est attendue selon le niveau de couverture vise

Document de cadrage associe:

- `docs/EXTERNAL_SOURCES_PLAN.md`

## Revue code

Revue rapide effectuee sur `2026-03-26`.

Conclusion:

- pas de dette critique identifiee
- pas de code mort significatif dans le pipeline d'import
- pas de regression bloquante detectee sur les changements wizard / admin / progression
- quelques reliquats UI ont ete nettoyes

Nettoyages appliques:

- suppression du helper JS mort `formatObjectPairs`
- suppression du style CSS mort `.eyebrow`
- simplification de `getMediaEntries()` pour eviter la creation d'un champ `slot` inutilise
- correction du suivi de job frontend pour que le wizard poll correctement l'update

## Suite logique

Phase suivante recommandee:

1. approfondir le simulateur `legacy` avec des projections encore plus proches du comportement reel d'inheritance
2. implementer la brique `Visualizers` pour les `races` et `cm_targets`
3. introduire les objets `builds` et les evaluations de faisabilite CM
4. conserver la separation stricte entre reference globale, donnees utilisateur et futures couches `Meta / Insights`

Document de cadrage associe:

- `docs/CM_BUILD_PLAN.md`
- `docs/EXTERNAL_SOURCES_PLAN.md`
