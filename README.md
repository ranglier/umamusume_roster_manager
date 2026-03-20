# Umamusume Roster Manager

Base de connaissance legere pour maintenir un roster Umamusume Pretty Derby oriente preparation de builds Champions Meeting.

Le depot est pense pour repondre a des questions concretes sur un compte reel:

- quelles candidates sont pretes, presque pretes, ou bloquees
- quels builds sont realistes avec une seule borrow
- quels parents il faut farmer pour une piste donnee
- quelles supports manquent le plus
- quels plans d'entrainement sont credibles pour une candidate

## Philosophie

- `Account-first`: on documente d'abord ce qui est vrai pour ton compte, pas une tier list abstraite.
- `Human-readable`: les donnees editees a la main sont en `TOML`, un fichier par entite.
- `Assistant-friendly`: les liens croises passent par des IDs stables, les vues `Markdown` sont generees et versionnees.
- `No heavy stack`: seulement Python standard library pour valider et produire des syntheses.
- `Practical honesty`: on separe explicitement theorie, faisabilite reelle, et etat de preparation.

## Structure

```text
.
├── README.md
├── docs/
│   ├── assistant-usage.md
│   ├── conventions.md
│   └── workflow.md
├── templates/
├── data/
│   ├── account/
│   ├── characters/
│   ├── supports/
│   ├── parents/
│   └── cms/
├── scripts/
└── views/
```

## Donnees canoniques

- `data/account/profile.toml`
  Contexte global du compte: CM active, limite de borrow, scenarios disponibles, notes globales.
- `data/characters/*.toml`
  Personnages jouables et leur etat reel.
- `data/supports/*.toml`
  Supports possedees, empruntables, ou manquantes mais structurantes.
- `data/parents/*.toml`
  Parents farmes, empruntes, ou a fabriquer.
- `data/cms/<cm-id>/cm.toml`
  Preparation d'une piste Champions Meeting.
- `data/cms/<cm-id>/builds/*.toml`
  Builds concrets rattaches a un CM cible.

## Vues generees

- `views/overview.md`
  Synthese globale du roster et des priorites.
- `views/cms/*.md`
  Vue lisible par CM avec piste, candidates, builds, blocages et priorites de farm.

Ces fichiers sont regeneres par script et commites pour rester lisibles directement dans GitHub.

## Commandes utiles

```bash
python3 scripts/validate.py
python3 scripts/render_views.py
```

Workflow conseille apres chaque edition:

1. modifier ou ajouter les fichiers `TOML`
2. lancer `python3 scripts/validate.py`
3. lancer `python3 scripts/render_views.py`
4. relire `views/overview.md`

## Comment ajouter ou modifier une candidate

1. Copier `templates/character.template.toml` vers `data/characters/<id>.toml`
2. Renseigner l'identite et la progression
3. Renseigner les profils jouables: distance, style, surface, roles
4. Separer clairement:
   - `theoretical_power`
   - `practical_fit`
   - `readiness_state`
   - `readiness.blockers`
5. Lier les parents, supports et scenarios recommandes par ID
6. Mettre `updated_at` au format `YYYY-MM-DD`

## Comment ajouter ou modifier une support

1. Copier `templates/support.template.toml`
2. Decrire ce qu'elle apporte vraiment:
   - stats
   - skill access
   - recovery
   - accel
   - utility
3. Marquer si elle est:
   - possedee et disponible
   - borrow only
   - manquante
4. Renseigner ses restrictions explicites si pertinentes

## Comment ajouter un parent

1. Copier `templates/parent.template.toml`
2. Ecrire le role du parent en une phrase utile
3. Preciser s'il est:
   - generique
   - track specific
   - style fix
   - distance fix
   - debuff
   - unique inherit
4. Documenter les sparks et l'usage vise

## Comment ajouter un CM

1. Creer `data/cms/<cm-id>/`
2. Copier `templates/cm.template.toml` vers `data/cms/<cm-id>/cm.toml`
3. Renseigner les facts de piste et les implications skills
4. Lister les candidates envisagees, validees, les blocages, et le plan de preparation

## Comment ajouter un build

1. Copier `templates/build.template.toml` dans le dossier `builds/` du CM cible
2. Rattacher le build a une candidate et au `cm_id`
3. Decrire le deck support prevu, les parents prevus et la borrow
4. Renseigner les priorites de skills, le scenario, la difficulte et la viabilite
5. Mettre a jour le build apres un vrai run dans `result_summary` et `post_run_notes`

## Exemples inclus

Le depot bootstrappe un mini jeu de donnees coherent:

- plusieurs candidates avec etats differents: prete, presque prete, bloquee
- un CM sample sur `Tokyo 1600m turf left`
- un build realiste avec une borrow
- plusieurs supports et deux parents pour illustrer un vrai deck et une vraie preparation

## Usage avec un assistant

Le repo est structure pour que Codex ou ChatGPT puisse raisonner vite.

Demande-lui de lire d'abord:

1. `README.md`
2. `docs/conventions.md`
3. `views/overview.md`
4. la vue du CM actif dans `views/cms/`
5. les fichiers `TOML` des candidates ou builds concernes

Exemples de prompts:

- "Lis `views/overview.md` et `data/cms/cm-2026-sample--tokyo-1600-turf-left/`. Propose-moi 2 builds realistes avec une seule borrow."
- "En te basant sur `data/characters/` et `data/supports/`, quelles units sont presque pretes pour le CM actif ?"
- "Quels parents dois-je farmer en priorite pour rendre Taiki Shuttle vraiment fiable sur Tokyo Mile ?"

## Notes

- Les donnees d'exemple sont la pour montrer la structure et la logique.
- Cette base n'essaie pas de modeliser tout le jeu: elle modelise d'abord ton compte, tes blocages et tes options reelles.
