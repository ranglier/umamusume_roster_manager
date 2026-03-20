# Conventions de donnees

## Principes generaux

- Un fichier `TOML` par entite.
- Nom de fichier = `id`.
- Tous les champs utilisent `snake_case`.
- Les dates utilisent toujours `YYYY-MM-DD`.
- Les notes libres restent en francais.
- Les IDs, enums et slugs restent en anglais ASCII.

## Regles de nommage

- Character: `<uma-slug>--<alt-slug>`
- Support: `<uma-slug>--<card-slug>--<rarity>`
- Parent: `<uma-slug>--<usage-slug>-v<nn>`
- CM: `cm-<year>-<label>--<venue>-<distance>-<surface>-<turn>`
- Build: `<cm-id>--<candidate-slug>--<style>-<profile>`

Exemples:

- `taiki-shuttle--original`
- `kitasan-black--speed-core--ssr`
- `maruzensky--mile-leader-generic-v1`
- `cm-2026-sample--tokyo-1600-turf-left`

## Distinctions importantes

### `theoretical_power`

Force theorique de l'unite ou du build si on ignore les limites du compte.

Valeurs:

- `high`
- `medium`
- `low`

### `practical_fit`

Niveau de faisabilite reelle avec le compte actuel, en prenant en compte supports, parents, temps de farm et niveau d'investissement.

Valeurs:

- `high`
- `medium`
- `low`

### `readiness_state`

Etat concret de preparation a court terme.

Valeurs:

- `ready_now`
- `farm_needed`
- `blocked`

Lecture recommandee:

- `ready_now`: tu peux serieusement lancer des runs tout de suite.
- `farm_needed`: la base existe mais il faut encore farmer ou nettoyer.
- `blocked`: impossible ou trop inefficace tant qu'un blocage majeur reste present.

## Enums controlees

### Distances

- `short`
- `mile`
- `medium`
- `long`

### Styles

- `runner`
- `leader`
- `betweener`
- `chaser`

### Surfaces

- `turf`
- `dirt`

### Character `assessment_status`

- `unreviewed`
- `potential`
- `to_test`
- `in_progress`
- `ready`
- `situational`
- `obsolete`

### Roles possibles

- `carry`
- `sub_carry`
- `speed_debuffer`
- `stamina_debuffer`
- `parent`
- `tech_pick`
- `composition_support`

### Support `support_type`

- `speed`
- `stamina`
- `power`
- `guts`
- `wisdom`
- `friend`
- `group`

### Support `availability`

- `available`
- `borrow_only`
- `missing`

### Support `status`

- `core`
- `good_replacement`
- `niche`
- `rarely_useful`

### Support `interest_tags`

- `stats`
- `skill_access`
- `recovery`
- `accel`
- `debuff`
- `utility`
- `scenario_link`

### Support `restrictions`

- `same_character_training_lock`
- `same_uma_support_family_exclusive`

### Parent `scope`

- `generic`
- `track_specific`
- `style_fix`
- `distance_fix`
- `debuff`
- `unique_inherit`

### Parent `ownership`

- `owned`
- `borrowed`

### Parent `status`

- `to_do`
- `farming`
- `usable`
- `good`
- `excellent`
- `replace`

### Parent `quality`

- `rough`
- `usable`
- `good`
- `excellent`

### Build `build_profile`

- `optimal_theory`
- `realistic_account`
- `budget`
- `experimental`
- `debuffer`

### Build `difficulty`

- `low`
- `medium`
- `high`
- `very_high`

### Build `viability`

- `strong`
- `playable`
- `risky`
- `blocked`

### Build `progress_state`

- `planned`
- `farming`
- `testing`
- `completed`
- `shelved`

## Champs requis par type

Le validateur s'assure au minimum des champs structurants:

- account: `account_id`, `active_cm_id`, `borrow_limit_per_training`, `updated_at`
- character: identite, etat, profils jouables, roles, liens utiles, `updated_at`
- support: identite, type, rarete, possession, disponibilite, utilite, restrictions, `updated_at`
- parent: identite, representative, scope, ownership, statut, usage, sparks, `updated_at`
- cm: identite, metadata de piste, candidats, plan de prep, `updated_at`
- build: identite, candidate, cm, profil, deck, parents, skill priorities, stats, progression

## Regles pratiques

- Les listes sont ordonnees par importance, pas alphabetiquement.
- Les `notes` et `*_summary` doivent rester courtes et actionnables.
- Un support non possede ne peut apparaitre dans un build que comme `borrow = true`.
- Un build ne doit pas depasser `borrow_limit_per_training`.
- Si une support a `same_character_training_lock`, elle ne peut pas entrainer la meme Uma.
- Si deux supports partagent le meme `character_slug` et portent `same_uma_support_family_exclusive`, elles ne doivent pas coexister dans le meme deck.
