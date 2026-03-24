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

Les builds, les parents personnels et l'optimisation Champions Meeting ne sont pas encore traites.

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
- `dist/`

Cette separation permet de garder:

- la tracabilite des sources
- un schema stable pour les evolutions futures
- une UI decouplee des formats bruts GameTora

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

- page d'entree de selection de profil
- creation, selection et suppression de profils
- stockage local des profils dans `data/user/`
- stockage roster separe par profil
- `My Roster` limite aux personnages et supports possedes
- `Catalog` pour ajouter / retirer les personnages et supports possedes
- edition locale des personnages et supports depuis `My Roster`
- fond video local sur la page de selection de profil

API locale ajoutee:

- `GET /api/profiles`
- `POST /api/profiles`
- `POST /api/profiles/select`
- `DELETE /api/profiles/<id>`
- `GET /api/profiles/<id>/roster`
- `PUT /api/profiles/<id>/roster`

### 5. Assets visuels locaux

Le projet telecharge et sert localement:

- icones de skills
- portraits de characters
- icones de supports
- illustrations de supports
- bannieres de races

Le but est d'eviter tout appel a GameTora au moment de la consultation.

### 6. Donnees relationnelles utiles pour la suite

Des liens utiles ont ete preserves dans le referentiel:

- skills d'un character: unique, innate, awakening, event
- hint skills et event skills des supports
- navigation inverse depuis un skill vers characters / supports
- `compatibility` comme entite de reference, pas comme simple outil annexe

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

### Python pour le pipeline d'update

Choix:

- pipeline d'import implemente en Python standard library

Pourquoi:

- cross-OS sans changer la philosophie du projet
- bon support pour le telechargement, JSON et la generation de fichiers
- suffisant pour une phase 1 locale sans ajouter de dependances externes

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

## Prochaine etape logique

La suite naturelle est maintenant d'enrichir la phase 2:

- enrichir le roster personnel au-dela de la possession simple
- conserver la separation stricte entre reference globale et donnees utilisateur
- preparer ensuite les croisements necessaires a la phase builds / CM

Un cadrage dedie a la future couche `builds / Champions Meeting` est disponible dans:

- `docs/CM_BUILD_PLAN.md`
