# Utiliser ce depot avec un assistant

## Lecture minimale recommandee

Pour des reponses rapides et credibles, demande a l'assistant de lire dans cet ordre:

1. `README.md`
2. `docs/conventions.md`
3. `views/overview.md`
4. la vue du CM actif dans `views/cms/`
5. les fichiers `TOML` directement lies a la question

## Prompts utiles

### Identifier les meilleures options

> Lis `views/overview.md` puis `data/cms/cm-2026-sample--tokyo-1600-turf-left/`. Quelles sont mes meilleures options realistes pour cette piste, et pourquoi ?

### Proposer des builds

> En te basant sur `data/characters/`, `data/supports/`, `data/parents/` et `data/cms/cm-2026-sample--tokyo-1600-turf-left/`, propose 3 builds realistes avec mon compte, classes par fiabilite.

### Prioriser le farm

> Quels farms ont le meilleur ROI pour rendre Taiki Shuttle vraiment stable sur le CM actif ?

### Evaluer les blocages

> Quelles supports ou quels parents manquent le plus pour debloquer Grass Wonder sur Tokyo Mile ?

## Bonnes pratiques

- Demander a l'assistant de citer les fichiers utilises.
- Commencer par les vues `Markdown`, puis ouvrir les fichiers `TOML` necessaires.
- Ne pas demander une tier list abstraite si la question porte sur le compte reel.
- Ajouter les derniers retours de run dans les builds avant de demander une recommandation.

## Ce qu'un assistant peut faire facilement avec cette base

- classer les candidates par etat reel
- proposer des builds realistes ou budget
- identifier les blocages communs
- suggerer des priorites de farm parent
- comparer plusieurs archetypes pour un CM
