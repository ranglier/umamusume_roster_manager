# CM Build Plan

## Objet

Ce document prepare la future couche `builds / Champions Meeting` du projet.

L'objectif n'est pas encore d'implementer le moteur, mais de cadrer:

- ce qu'est un build CM exploitable
- quelles donnees sont deja presentes
- quelles donnees et couches nous manquent encore
- quelles approches sont possibles pour la creation automatique de builds

Le point de depart reste la philosophie actuelle du projet:

- reference locale fiable
- donnees utilisateur separees
- serveur Python local leger
- UI statique locale
- logique explicable plutot que "boite noire"

## Ce qu'un build CM doit couvrir

Un build CM correct ne se limite pas a "choisir un personnage". Il faut au minimum pouvoir raisonner sur:

1. la cible CM
   - hippodrome
   - surface
   - distance
   - sens
   - saison
   - etat de piste / weather si utile
   - historique des editions CM pour comparer les metas

2. le candidat principal
   - personnage / variante
   - aptitudes de base
   - statistiques cibles
   - skills uniques / awakening / evolution
   - contraintes de roster reel

3. le deck de supports
   - cartes possedees
   - rarete
   - niveau reel
   - limit break
   - effet attendu par niveau
   - hints, event skills et synergies

4. l'inheritance / les parents
   - parents disponibles localement
   - facteurs reels (stats, aptitudes, scenario, G1, etc.)
   - compatibilite
   - objectifs d'aptitudes a atteindre pour la cible CM

5. le scenario d'entrainement
   - scenario choisi
   - caps de stats
   - mecaniques propres au scenario
   - skills / factors de scenario
   - impact sur la faisabilite du build

6. le plan de build lui-meme
   - repartition de stats cible
   - aptitudes cibles
   - skill package principal
   - skills optionnelles / substitutes
   - hypotheses et raisons du choix

7. le resultat reel apres run
   - build planifie
   - build obtenu
   - ecarts
   - notes de test en CM

## Ce que le projet possede deja

Le projet a deja une base tres utile pour cette phase:

- `characters`
  - variantes
  - aptitudes
  - statistiques de base
  - skills uniques / innate / awakening / event / evolution

- `supports`
  - type
  - rarete
  - effects
  - unique effects
  - hint skills
  - event skills
  - stat gain

- `skills`
  - tags
  - descriptions
  - cout
  - rarete
  - condition groups
  - gene versions / parent skill ids

- `races`
  - surface
  - distance
  - sens
  - saison
  - grade
  - lien vers les facteurs

- `racetracks`
  - geometrie de piste
  - phases
  - pentes
  - longueurs
  - layout

- `g1_factors`
  - facteurs G1
  - courses associees

- `compatibility`
  - groupes de relation
  - pairwise points
  - base utile pour l'inheritance

- `My Roster`
  - possession des `characters`
  - possession des `supports`
  - niveau / limit break des supports
  - stars / awakening des characters

En bref: la reference locale actuelle couvre deja une bonne partie du "catalogue" necessaire au build, mais pas encore les couches "preparation du run", "legacy reel", "plan de build" et "evaluation CM".

## Ce qu'il manque pour faire correctement les builds

### 1. Une cible CM explicite

Aujourd'hui, l'application n'a pas de notion de "target event".

Il nous faut une nouvelle couche de reference normalisee pour les editions `Champions Meeting`, idealement alimentee depuis le dataset GameTora `events/champions-meeting`.

Cette couche doit fournir:

- l'identite de l'edition
- ses dates
- son profil de course
- une vue derivee "build target"
- un historique local des anciennes editions

Sans cette couche, toute recommandation de build reste trop abstraite.

### 2. Une vraie couche `legacy / parents`

Le projet n'a pas encore de roster pour les parents.

Pourtant, des builds CM serieux ont besoin de:

- quels parents l'utilisateur possede
- quels facteurs exacts ils portent
- quels aptitudes / scenario / G1 ils apportent
- quelle compatibilite ils ont avec le candidat principal

Il faudra donc ajouter une couche utilisateur dediee, separee du roster courant, par exemple:

- `data/user/profiles/<profile_id>/legacy.json`

Cette couche devra stocker au minimum:

- les parents sauvegardes
- leur personnage / variante
- leurs facteurs reels
- leur build d'origine si connu
- des notes et tags libres

### 3. Une vraie couche `builds`

Il nous faut un objet metier explicite "build".

Exemple de structure cible:

```json
{
  "id": "b_001",
  "mode": "champions_meeting",
  "target_id": "cm_044",
  "character_id": "100101",
  "scenario_id": "11",
  "support_deck": ["10001", "30137", "30052", "20019", "30101", "friend:30210"],
  "legacy_pair": {
    "parent_a": "legacy_014",
    "parent_b": "legacy_032"
  },
  "target_stats": {
    "speed": 1700,
    "stamina": 1200,
    "power": 1400,
    "guts": 1100,
    "wisdom": 1200
  },
  "target_aptitudes": {
    "surface": "S",
    "distance": "A",
    "style": "A"
  },
  "required_skills": ["200452", "200492"],
  "optional_skills": ["201132"],
  "status": "draft"
}
```

Ce document `build` doit etre distinct:

- du roster
- de la reference
- du resultat reel d'une run

### 4. Une couche "resultat de run"

Un build CM n'est pas seulement une intention. Il faut aussi pouvoir saisir ou importer:

- les stats finales obtenues
- les aptitudes finales
- les skills effectivement apprises
- les skills manquantes
- les parents utilises
- le deck reellement joue
- des notes de test / matchup

Sans cette couche, on ne pourra pas fermer la boucle entre recommandation et resultat reel.

### 5. Les donnees de progression des supports par niveau

Le roster sait deja stocker:

- `level`
- `limit_break`

Mais le referentiel local n'importe pas encore les tables permettant de recalculer proprement la puissance d'une support selon son niveau reel.

Le manifest GameTora expose deja un dataset utile:

- `db-files/support_card_level`

Il faudra verifier exactement comment relier cette table aux supports normalises pour pouvoir:

- estimer la vraie valeur d'une support dans une suggestion de deck
- differencier un deck "theorique maxed" d'un deck "realiste pour le profil actif"

### 6. Les donnees d'awakening / progression character plus exploitables

Le roster sait deja stocker:

- `stars`
- `awakening`

Mais nous ne normalisons pas encore les donnees permettant de raisonner proprement sur:

- les couts d'awakening
- les skills unlockees par palier
- la progression necessaire pour rendre un build faisable

Le manifest GameTora expose deja un dataset utile:

- `db-files/card_talent_upgrade`

### 7. Les scenarios d'entrainement comme entites de reference

Pour l'instant, le projet ne modele pas les scenarios.

Or un build CM depend fortement du scenario choisi:

- caps de stats
- skills / evolutions de scenario
- sparks / factors de scenario
- evenements et contraintes
- rendement reel du run

Le manifest GameTora expose deja plusieurs datasets utiles:

- `scenarios`
- `static/scenarios`
- `static/scenario_factors`

Ces donnees ne suffiront probablement pas a elles seules a capturer toute la strategie, mais elles sont une tres bonne base pour:

- identifier les scenarios
- stocker leurs caps et factors
- relier ensuite des heuristiques scenario-specifiques

### 8. Les evenements d'entrainement

Pour automatiser reellement un build, il faudra a terme mieux modeliser les events:

- common events
- character events
- support events
- scenario events

Le manifest GameTora expose deja une famille de datasets pertinente:

- `training_events/shared`
- `training_events/char`
- `training_events/char_card`
- `training_events/friend`
- `training_events/group`
- `training_events/scenario`
- `training_events/sr`
- `training_events/ssr`

Attention:

- ces datasets semblent beaucoup plus "bruts" et moins directement exploitables que ceux deja integres
- ils seront probablement utiles pour une phase avancee d'assistance et de simulation
- ils ne sont pas necessaires pour une v1 de planning de build

### 9. Les race instances / planning de course

Pour optimiser un run, il faudra probablement raisonner sur les courses accessibles pendant l'entrainement:

- objectifs du personnage
- courses optionnelles
- gains de fans
- gains de skill points
- facteurs G1 vises

Datasets potentiellement utiles:

- `race_instances`
- `ura-objectives`
- `ura-race-rewards`

L'interet principal n'est pas le CM direct, mais la faisabilite du build pendant l'elevage.

### 10. Les status effects

Ce n'est pas un prerequis pour une v1 de build planner, mais le dataset `status-effects` peut servir plus tard a:

- expliquer les debuffs / conditions d'etat
- enrichir la lecture des events et des runs

## Manques de produit et de modele utilisateur

Au-dela de la reference, il nous manque aussi plusieurs briques cote profil:

### Ce que le profil ne sait pas encore stocker

- parents / legacies possedes
- builds sauvegardes
- runs finalisees
- tags perso de build
- evaluation subjective ("stable", "greedy", "anti-front", etc.)
- historique de tests CM

### Ce qu'il manque dans l'UI

- une page `CM Targets`
- une page `Builds`
- une page `Legacies`
- un comparateur de builds
- une vue "faisabilite" d'un build pour le profil actif
- une vue "manques" montrant ce qu'il faut encore obtenir / monter

### Ce qu'il manque dans l'API locale

Probable extension du serveur local avec:

- `GET /api/profiles/<id>/legacies`
- `PUT /api/profiles/<id>/legacies`
- `GET /api/profiles/<id>/builds`
- `POST /api/profiles/<id>/builds`
- `PUT /api/profiles/<id>/builds/<build_id>`
- `DELETE /api/profiles/<id>/builds/<build_id>`

## Ce qu'il faut mettre en place en premier

Ordre recommande:

### Etape 1. Cibles CM normalisees

Ajouter une nouvelle entite de reference:

- `cm_targets`

Source principale:

- `events/champions-meeting`

Objectif:

- pouvoir selectionner une edition CM precise
- en deriver un profil de build unique

### Etape 2. Scenarios normalises

Ajouter une entite:

- `scenarios`

Source principale:

- `scenarios`
- `static/scenarios`
- `static/scenario_factors`

Objectif:

- pouvoir attacher un build a un scenario concret

### Etape 3. Legacies utilisateur

Ajouter une couche utilisateur:

- `legacy roster`

Objectif:

- connaitre les parents reels disponibles pour un profil

### Etape 4. Build documents

Ajouter une couche utilisateur:

- `builds`

Objectif:

- stocker un build planifie
- suivre sa faisabilite
- comparer plusieurs drafts

### Etape 5. Evaluation locale deterministe

Avant toute automatisation ambitieuse, il faut un premier moteur explicable:

- verifie les aptitudes cibles
- verifie les skills disponibles via character + supports + legacy
- verifie les incompatibilites evidentes
- estime la faisabilite par rapport au roster actif

Cette couche est critique, car elle sert ensuite de fondation a toute suggestion automatique.

## Possibilites pour la creation automatique de builds

Il y a plusieurs niveaux possibles d'automatisation.

### Option A. Assistant de build guide par contraintes

Principe:

- l'utilisateur choisit une cible CM
- le systeme filtre les candidates plausibles
- puis filtre les supports, legacies et skills selon des regles simples

Ce que ca sait bien faire:

- proposer rapidement des options credibles
- rester lisible et explicable
- respecter la philosophie actuelle du projet

Limites:

- peu "intelligent" face aux compromis fins
- ne simule pas vraiment la run

Niveau de difficulte:

- faible a moyen

Recommendation:

- tres bon point de depart

### Option B. Moteur de scoring deterministe

Principe:

- chaque build candidat recoit un score
- le score combine:
  - adequation au CM
  - faisabilite roster
  - valeur du deck de supports
  - coherence des aptitudes
  - couverture des skills

Ce que ca sait bien faire:

- classer plusieurs builds
- expliquer les arbitrages
- rester local et rapide

Limites:

- tres sensible a la qualite des poids et heuristiques
- ne capture pas parfaitement la variance d'une run

Niveau de difficulte:

- moyen

Recommendation:

- probablement la meilleure base pour une vraie v1 d'automatisation

### Option C. Optimisation par recherche sur espace de builds

Principe:

- generer des combinaisons de:
  - character
  - scenario
  - support deck
  - legacy pair
  - package de skills
- puis garder les meilleures selon le moteur de scoring

Ce que ca sait bien faire:

- explorer beaucoup plus de solutions
- sortir des combinaisons non triviales

Limites:

- explosion combinatoire rapide
- besoin d'un tres bon scoreur en amont

Niveau de difficulte:

- moyen a eleve

Recommendation:

- bonne etape 2 apres le moteur de scoring

### Option D. Simulation de run / moteur stochastique

Principe:

- simuler une run d'entrainement avec scenario, supports, events, objectifs, races et outcomes probables
- optimiser le build sur le resultat simule plutot que sur une heuristique statique

Ce que ca sait bien faire:

- approcher le vrai probleme de la creation de build
- mieux capter la faisabilite reelle

Limites:

- de loin l'option la plus complexe
- forte dependance a des modeles de scenario et d'events tres complets
- enorme cout de calibration

Niveau de difficulte:

- tres eleve

Recommendation:

- a garder comme horizon long terme, pas comme point d'entree

### Option E. LLM / IA generative comme moteur principal

Principe:

- demander a un modele de proposer un build "intelligent"

Avantage:

- utile pour expliquer, commenter, resumer

Limites:

- faible fiabilite si utilise comme source de verite
- difficile a reproduire
- peu compatible avec l'objectif de reference locale explicable

Recommendation:

- ne pas utiliser comme moteur principal de build
- eventuellement utile plus tard comme couche d'explication par-dessus un moteur deterministe

## Recommendation de strategie

La strategie la plus pertinente pour ce projet semble etre:

1. reference enrichie
   - `cm_targets`
   - `scenarios`
   - tables de progression support / awakening

2. profil enrichi
   - `legacies`
   - `builds`
   - `run_results`

3. moteur v1 deterministe
   - filtres
   - checks de faisabilite
   - scoring explicable

4. automatisation v1
   - generation de candidats
   - ranking
   - comparaison

5. automatisation avancee
   - recherche plus profonde
   - eventuellement simulation de run

Autrement dit:

- commencer par un assistant/scorer local et explicable
- ne pas viser tout de suite un simulateur complet

## Proposition de phases concretes

### Phase 3A. Fondations reference

Ajouter au pipeline:

- `cm_targets`
- `scenarios`
- support progression metadata
- awakening progression metadata

Sortie attendue:

- nouvelles entites dans la reference locale

### Phase 3B. Fondations utilisateur

Ajouter aux profils:

- `legacies`
- `builds`
- `run_results`

Sortie attendue:

- nouvelles API locales
- nouveaux fichiers JSON utilisateur

### Phase 3C. Build planner manuel assiste

Ajouter a l'UI:

- choix d'une cible CM
- choix d'un character
- choix d'un scenario
- choix d'un deck de supports
- choix de parents
- edition d'un draft de build

Sortie attendue:

- premier planner utilisable sans auto-generation

### Phase 3D. Faisabilite et scoring

Ajouter un moteur local pour:

- detecter les blocages
- calculer un score
- comparer plusieurs drafts

Sortie attendue:

- feedback concret pour le profil actif

### Phase 3E. Auto-build v1

Ajouter:

- generation de candidats
- tri des meilleurs builds
- variantes "safe" / "greedy" / "budget"

Sortie attendue:

- premiere creation automatique exploitable

## Questions ouvertes

- jusqu'ou veut-on aller sur la simulation de run, ou reste-t-on sur une planification statique ?
- veut-on stocker un build comme une intention, un resultat final, ou les deux ?
- quelle granularite souhaite-t-on pour les legacies: simple liste de parents ou vrai inventaire de builds sources ?
- veut-on d'abord optimiser la qualif d'un build pour une cible CM, ou la production du build pendant l'entrainement ?
- quel niveau d'explicabilite veut-on imposer a l'auto-build ?

## Recommandation immediate

La prochaine etape la plus saine n'est pas encore "l'auto-build".

La prochaine etape recommandee est:

1. ajouter `cm_targets`
2. ajouter `scenarios`
3. concevoir la couche `legacies`
4. concevoir le format `build`

Une fois ces quatre briques posees, on pourra commencer l'etude implementation par implementation du moteur de scoring, puis de l'auto-generation.

## Sources utiles

Sources GameTora consultees pour ce cadrage:

- manifest JSON: `https://gametora.com/data/manifests/umamusume.json`
- page principale Uma Musume GameTora: `https://beta.gametora.com/umamusume`
- article Race Mechanics Handbook: `https://beta.gametora.com/umamusume/race-mechanics`
- outil Skill Condition Viewer: `https://beta.gametora.com/umamusume/skill-condition-viewer`
- outil Race Scheduler: `https://beta.gametora.com/umamusume/race-scheduler`
- guide de scenario (exemple): `https://beta.gametora.com/umamusume/design-your-island`

Datasets GameTora particulierement pertinents identifies dans le manifest:

- `events/champions-meeting`
- `race_instances`
- `scenarios`
- `static/scenarios`
- `static/scenario_factors`
- `db-files/support_card_level`
- `db-files/card_talent_upgrade`
- `training_events/*`
- `ura-objectives`
- `ura-race-rewards`
- `status-effects`
