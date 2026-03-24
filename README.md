# Umamusume Pretty Derby Local Reference

Referentiel local et roster manager pour `Umamusume Pretty Derby`, alimente depuis GameTora, stocke localement, consultable hors ligne et mettable a jour via une commande dediee.

Le projet couvre aujourd'hui:

- `characters`
- `supports`
- `skills`
- `races`
- `racetracks`
- `g1_factors`
- `compatibility`
- profils locaux
- roster personnel local pour `characters` et `supports`

Hors perimetre a ce stade:

- parents personnels
- builds
- recommandations Champions Meeting
- scoring / optimisation

## Vue d'ensemble

Le projet suit une separation simple et stable:

- `data/raw/`: sources GameTora telechargees telles quelles
- `data/normalized/`: schema local stable
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
5. construction d'un bundle statique local

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
|     `- gametora_reference.py
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

- variante pratique pour regénérer puis servir dans la foulée:

```bash
python ./scripts/serve_reference.py --update-first --open
```

- URL locale: `http://127.0.0.1:8000/`
- endpoint sante: `http://127.0.0.1:8000/__health`
- endpoint metadata: `http://127.0.0.1:8000/__meta`
- endpoint profils: `http://127.0.0.1:8000/api/profiles`
- l'application ouvre sur un selecteur de profil
- apres selection, la vue par defaut est `My Roster / Characters`
- `My Roster` n'affiche que les `characters` et `supports` possedes
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
- [`data/normalized/reference-meta.json`](c:\Users\034927N\PERSO\Umamusume_Roster_Manager\data\normalized\reference-meta.json)

Resume du modele:

- `characters`: variantes, aptitudes, bonus de stats, stats, profil, liens de skills
- `supports`: type, rarete, effets, unique effects, hint skills, event skills, stat gain
- `skills`: rarete, cout, activation, tags, descriptions, conditions
- `races`: hippodrome, surface, distance, direction, saison, grade, liens facteurs
- `racetracks`: geometrie de piste, phases, pentes, longueurs, layout
- `g1_factors`: facteurs G1 et courses associees
- `compatibility`: groupes de relation et top matches pour l'inheritance futur

## Interface locale

L'UI locale permet:

- selection de profil
- `My Roster` pour les `characters` / `supports` possedes
- `Catalog` pour parcourir la reference et alimenter le roster
- navigation par dataset
- recherche texte
- filtres
- consultation detaillee
- affichage des visuels locaux
- navigation croisee entre entites
- edition locale des entrees possedees
- affichage de la source et de la date d'import locale

L'UI source est dans:

- `src/ui/index.html`
- `src/ui/assets/app.js`
- `src/ui/assets/app.css`

Le bundle servi localement est dans:

- `dist/index.html`
- `dist/assets/app.js`
- `dist/assets/app.css`
- `dist/data/reference-data.js`

Note:

- `dist/data/` et `dist/media/` sont regeneres localement et exclus du versioning Git

## Fichiers clefs

- configuration des sources: `config/sources.json`
- pipeline import / normalisation / build: `scripts/lib/gametora_reference.py`
- commande d'update: `scripts/update_reference.py`
- serveur local de consultation: `scripts/serve_reference.py`
- metadonnees raw: `data/raw/metadata.json`
- catalogue assets: `data/raw/assets/metadata.json`

## Hypotheses et limites

- GameTora doit continuer d'exposer son manifest public et ses datasets JSON versionnes.
- `compatibility` est conservee comme base de calcul, sans integration directe des bonus G1 dans un score compose.
- le roster personnel reste local, sans sync cloud ni multi-utilisateur
- l'updater repose sur Python standard library pour rester cross-OS sans dependances externes
- la consultation locale est recommandee via HTTP local pour rester cross-navigateur
- le depot Git ne contient pas les donnees GameTora importees; elles doivent etre regenerees localement

## Revue code

Revue rapide effectuee sur `2026-03-24`.

Conclusion:

- pas de dette critique identifiee
- pas de code mort significatif dans le pipeline d'import
- quelques reliquats UI ont ete nettoyes

Nettoyages appliques:

- suppression du helper JS mort `formatObjectPairs`
- suppression du style CSS mort `.eyebrow`
- simplification de `getMediaEntries()` pour eviter la creation d'un champ `slot` inutilise

## Suite logique

Phase suivante recommandee:

1. enrichir le roster personnel au-dela de la possession simple
2. conserver la separation stricte entre reference globale et donnees utilisateur
3. preparer ensuite les vues et heuristiques pour les builds / Champions Meeting
