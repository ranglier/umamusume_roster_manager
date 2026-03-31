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

## Recommandation immediate

La prochaine tranche recommandee n'est pas encore la meta.

La prochaine tranche a implementer est:

1. poser la brique `Visualizers`
2. livrer un `Race Skill Visualizer` local MVP
3. l'afficher dans `races`, puis `cm_targets`
4. seulement apres, cadrer un adaptateur `Meta / Insights`

Cette sequence maximise:

- l'utilite immediate
- la robustesse
- la coherence avec le futur moteur de build CM
