# Workflow de maintenance

## Cycle court conseille

1. Mettre a jour ou ajouter les fichiers `TOML`
2. Lancer `python3 scripts/validate.py`
3. Corriger les erreurs ou warnings
4. Lancer `python3 scripts/render_views.py`
5. Relire `views/overview.md` et la vue du CM actif
6. Committer

## Quand ajouter une candidate

Ajoute une candidate quand au moins une de ces conditions est vraie:

- tu envisages serieusement de la jouer sur un CM
- elle a une valeur parent importante
- elle est un fallback realiste
- elle a besoin d'un suivi de blocage

Ne transforme pas `data/characters/` en encyclopedie. Le but est la decision, pas l'exhaustivite.

## Quand ajouter une support

Ajoute une support si:

- tu la possedes
- elle est un borrow frequent
- elle manque et bloque plusieurs builds

Si une carte ne change aucune decision, elle peut attendre.

## Quand ajouter un parent

Un parent merite son propre fichier si son role est clair. La phrase suivante doit etre facile a completer:

> "Je garde ce parent pour ..."

Si tu ne peux pas finir cette phrase, le parent n'est pas encore assez mature pour etre suivi.

## Quand creer un build

Cree un build seulement si:

- la candidate est liee a un CM precis
- le role dans l'equipe est clair
- le deck support et le plan d'heritage sont au moins esquisses

Sinon garde l'idee dans les notes de la candidate ou du CM.

## Checklist candidate

- identite stable
- evaluation theorique et pratique
- etat concret de preparation
- blocages explicites
- supports et parents recommandes
- cibles de stats

## Checklist support

- utilite principale
- utilites secondaires
- cartes ou builds vraiment aides
- disponibilite reelle
- restrictions explicites

## Checklist parent

- representative claire
- role clair
- scope clair
- sparks utiles
- statut et qualite clairs

## Checklist CM

- facts de piste utiles
- implications skills
- archetypes jouables
- candidates et builds suivis
- plan de farm

## Checklist build

- objectif realiste
- role dans la compo
- 6 slots support renseignes
- 2 parents renseignes
- skills prioritaires et inutiles
- viabilite et difficulte renseignees
