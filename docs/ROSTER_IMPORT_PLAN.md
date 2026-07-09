# Roster Import Plan — import des supports par screenshots

## Objet

Plan d'implementation du MVP d'import de roster par captures d'ecran,
cadre et valide par spikes dans `docs/EXTERNAL_SOURCES_PLAN.md` (section
"Import et synchronisation du roster depuis le jeu"). Ce document est le
plan d'execution; l'autre contient le pourquoi (frein #1 d'adoption), les
alternatives ecartees et les verdicts de spike.

## Decisions actees (ne pas re-debattre)

- **Perimetre MVP: `supports` uniquement.** Cas resolu 30/30 par le spike.
  Les umas sont hors perimetre (pas d'asset public au bon cadrage, ~40-50%
  top-1) et restent saisies a la main.
- **Moteur 100% client-side (JS/Canvas), zero dependance ajoutee.** Decide
  pour le packaging futur (ne pas approfondir la dependance au runtime
  Python) et le local-first (aucun appel externe a l'execution). La methode
  du spike (dHash + histogramme couleur) se porte trivialement en Canvas.
- **La reconciliation avec confirmation est le coeur du flux**, pas un
  filet: on vise "quasi tout juste + verification rapide", pas 100% aveugle.
- **Geometrie de grille calee sur l'appareil de l'utilisateur** (captures
  1080x2392, grille 6x5, constantes mesurees au spike), mise a l'echelle
  proportionnelle a la largeur. Pas de detection generique de grille au MVP.

## La recette validee (a porter telle quelle)

Pour chaque cellule de la grille (base 1080px: origine 45,295; carte
180x240; pas 202x275):

1. **Identite** — zone d'art aux memes fractions des deux cotes
   (x 10-90%, y 14-78%) sur la cellule ET sur l'illustration de reference
   (`dist/media/reference/supports/<id>.png`, 450x600, meme artwork/ratio):
   - dHash 64 bits (grayscale 9x8, gradient horizontal), **min sur 5
     jitters** de la boite (+/-2% en x ou y)
   - histogramme couleur 6x6x6 (216 bins, normalise)
   - score = `dHamming - 10 * intersection_histogrammes`; tri croissant
   - confiance: `d <= 12 et gap >= 2.0` -> auto; sinon "a verifier" avec
     top-3 propose
   - **ne PAS matcher contre `supports/icons/*.png`** (cadrage different,
     0/30 au spike)
2. **Niveau** — texte "Lvl XX" en bas de carte: OCR par template des 10
   glyphes (police fixe du jeu), glyphes extraits une fois des captures
   reelles et embarques en constantes JS (petits masques binaires)
3. **Limit break** — 4 gemmes en bas gauche: echantillonnage de couleur a 4
   positions connues (rempli = cyan, vide = gris)
4. Rarete/type: PAS lus sur l'image — donnes par la reference via l'id
   matche

## Architecture

```
src/ui/assets/js/roster_import_cv.js   # moteur pur: primitives CV + scoring
src/ui/assets/js/roster_import.js      # orchestration: fichiers, cache, UI
tests/js/test_roster_import_cv.mjs     # tests du moteur pur sur fixtures
```

- `roster_import_cv.js` — **pur, sans DOM** (testable sous node comme
  `build_scoring.js`): travaille sur des tableaux de pixels RGBA plats
  (`{width, height, data}`). Fonctions: `dhash64`, `hamming64` (le hash 64
  bits est manipule en **deux entiers 32 bits** ou BigInt — attention, les
  bitwise JS natifs tronquent a 32 bits), `colorHistogram`, `histIntersect`,
  `artBox`, `gridCells`, `scoreCandidate`, `rankCandidates`, `readLevel`,
  `readLimitBreak`, `reconcile(current, extracted)` (calcul de diff)
- `roster_import.js` — cote navigateur: decode les fichiers deposes
  (`FileReader` -> `Image` -> `canvas.drawImage` -> `getImageData`),
  construit/charge le cache d'empreintes, rend l'UI, applique le resultat
- Le **resize vers les tailles de hash est fait par le meme code Canvas des
  deux cotes** (references et cellules) — la coherence de l'algorithme de
  downscale compte plus que sa qualite; ne jamais melanger deux methodes de
  resize entre les deux cotes
- Serveur: **aucun changement**. Les illustrations sont deja servies
  (`/media/reference/supports/`), la sauvegarde passe par le
  `PUT /api/profiles/<id>/roster` existant (champs `owned`/`level`/
  `limit_break` deja valides par `normalize_roster_entry`)

### Cache des empreintes de reference

Hasher 534 illustrations a chaque import serait lent (chargement + decode).
Au premier import: charger les images (locales, rapide), calculer
`{dhash, histogramme}` par carte, stocker en `localStorage` sous une cle
versionnee par `generated_at` de la reference (invalide automatiquement
apres un update GameTora). Taille ~1 Ko/carte -> ~500 Ko, OK.

## Flux utilisateur cible

1. My Collection -> Supports -> bouton "Import from screenshots" (nouvelle
   presentation de la vue roster/supports, meme pattern que le switch
   Parents/Simulator de `legacy.js`)
2. L'utilisateur depose ses ~6 captures (drag & drop ou file picker),
   d'un coup ou en plusieurs fois
3. Table de reconciliation, une ligne par carte detectee: vignette de la
   cellule | carte matchee (image + nom + rarete) | niveau lu | LB lu |
   confiance. Lignes sous le seuil: dropdown top-3 pre-rempli. Toute ligne
   reste editable (select carte, input niveau, input LB)
4. Dedup par id matche entre captures (chevauchement de scroll): garder la
   lecture de meilleure confiance
5. Panneau de diff avant application: **nouvelles** (pas dans le roster) /
   **modifiees** (niveau ou LB different) / **inchangees** (masquees par
   defaut). L'import ne retire jamais une possession (pas de "carte absente
   des captures -> unowned" — les captures sont partielles par nature)
6. "Apply N changes" -> merge dans `state.rosterDocument.supports` ->
   `persistRosterDocument` (PUT roster existant)

## Phases d'implementation

### Phase A — fixtures + moteur pur + tests — LIVREE

Livre (`src/ui/assets/js/roster_import_cv.js` + `tests/js/test_roster_import_cv.mjs`,
16 tests; fixtures reelles dans `tests/js/fixtures/roster-import/`):

- fixtures extraites de la capture reelle: 6 cellules RGBA brutes (niveaux
  35/50/25/1/30/40, LB 1/4/2/4/0/2, verite terrain recoupee par les caps de
  rarete), 9 references 90x120 dont les paires confusables Suzuka SSR/R et
  Teio SSR/R, glyphes 0-5 embarques dans le module
- **validation e2e du moteur JS reel** (script jetable, capture complete
  contre les 534 illustrations pleine taille): identite **30/30 corrects**
  (28/30 confiants), niveaux 28/30 — les 2 erreurs de niveau sortent a
  confiance 0.52/0.56 la ou toutes les lectures justes sont >=0.96, donc le
  gating "a verifier" fonctionne —, LB 30/30 coherents. Perf: 1.3s pour
  empreinter 534 refs (une fois, a cacher), 104ms pour matcher+lire 30
  cellules
- decouvertes d'implementation: la position verticale de la bande "Lvl"
  varie de quelques px selon la carte (ne pas sur-contraindre les lignes);
  la limite de colonnes doit couvrir toute la region (un chiffre peut
  s'etendre jusqu'au bord — le coin arrondi se filtre par ligne-sommet de
  blob, pas par colonne); hauteur de chiffre bornee a 22px pour ecarter la
  courbe du coin fusionnee dans un blob
- limites connues: glyphes 6-9 absents (aucun niveau de la capture n'en
  contient — leurs lectures sortiront en basse confiance jusqu'a extension
  du jeu de templates); geometrie fixe 1080px (choix assume)

Detail de la phase telle que planifiee:

- Extraire des fixtures depuis les captures reelles deja fournies
  (`data/user/import_samples/`): quelques cellules en tableaux de pixels
  JSON (petits crops), les glyphes 0-9 du "Lvl", des exemples de gemmes
  pleines/vides. Script d'extraction jetable (scratchpad, Python) — les
  fixtures committees sont des petits crops anonymes de cartes, pas les
  captures completes
- Ecrire `roster_import_cv.js` + `tests/js/test_roster_import_cv.mjs`:
  dhash/hamming/histogramme/scoring reproduisent les resultats du spike sur
  les fixtures; `readLevel`/`readLimitBreak` sur les exemples extraits;
  `reconcile` (nouveau/modifie/inchange, jamais de retrait)
- Sortie: moteur teste, zero UI

### Phases B + C — branchement navigateur + UI de reconciliation — LIVREES

Livrees ensemble (`src/ui/assets/js/roster_import.js`, nouveau module):

- pipeline navigateur: `createImageBitmap` -> canvas -> `getImageData` ->
  moteur pur (decoupe de grille, empreintes, top-3, niveau, LB, vignette
  jpeg par cellule)
- cache d'empreintes: construit au premier import (les 534 illustrations
  locales, ~13s, avec progression affichee), stocke en `localStorage`
  (~260 Ko, histogrammes en sparse int — round-trip exact car 1024 = 2^10),
  versionne par `generated_at` de la reference; les imports suivants sont
  quasi instantanes
- UI: 3e presentation "Import" de la vue roster/supports (a cote de
  Detail/Batch, meme plein-ecran que Batch), dropzone + file picker, table
  de reconciliation (vignette capturee | carte matchee avec icone + select
  top-3 | niveau editable | LB editable | badge New/changed/unchanged/
  Unknown + avertissements dont depassement de cap via
  `getSupportLevelCap`), lignes "unchanged" repliees, barre "N selected ->
  Apply to my roster"
- application: merge dans `state.rosterDocument.supports` via
  `setRosterEntry` + `persistRosterDocument` (PUT roster existant), zero
  changement serveur comme prevu
- piege trouve et corrige en verification: le roster persiste **elague des
  valeurs par defaut** (`pruneRosterEntry` retire `level: 1` et
  `limit_break: 0`) -> le diff naif marquait "changed" toutes les cartes a
  valeurs par defaut au re-import (`undefined != 1`). Corrige en
  normalisant les entrees courantes avant `reconcile`/affichage
  (`normalizedSupportEntry`)

Verifie en navigateur sur la capture reelle (profil p_001): 30 cellules
lues, 28 matchs confiants + 2 "a verifier" (les 2 cas limites du spike,
leur bonne reponse en tete du top-3), correction d'une ligne via le
dropdown, application de 29 cartes (verifiees cote serveur via l'API,
y compris une correction de valeurs saisies a la main auparavant),
re-import de la meme capture -> **28 "already up to date", 0 selectionnee**
(idempotence), zero erreur console.

### Phase D — polissage guide par l'usage reel

Seulement apres un premier import complet reel: tolerance d'echelle si
l'utilisateur change de telephone, umas si une source d'asset apparait,
raccourcis UX. Ne rien pre-construire ici.

### Phase E — import des umas (debloquee, a implementer)

La source d'asset manquante a ete trouvee (icones in-game par variante du
depot `wrrwrr111/pretty-derby` + transformation de crop calibree — verdict
complet et risques dans `EXTERNAL_SOURCES_PLAN.md`, "Umas debloquees").
Valide sur la capture reelle: 32/35 confiants, discrimination par variante.

Travail:

- `scripts/fetch_chara_icons.py` (fait): telecharge les icones couvertes
  vers `dist/media/reference/characters/icons/<variante>.png` + manifest de
  provenance/couverture. Fetch one-shot separe de `update_reference.py`
  (source differente de GameTora, cadence differente); valide la signature
  PNG (le depot peut servir des fichiers corrompus)
- moteur (`roster_import_cv.js`): constantes umas — grille 7x5 (origine
  45,299, carte 180x~200 dont art 180x180, pas 202x242), boites calibrees
  `UMA_ICON_BOX = (28,46,238,227)` / `UMA_CELL_BOX = (8,8,172,150)`,
  lecture des **etoiles** (rangee sous le bandeau) et du **"Potential Lvl
  X"** (= awakening 1-5, OCR de glyphe, un seul chiffre, nouvelle police a
  extraire d'une capture)
- UI: toggle supports/umas dans la presentation Import (ou detection auto
  du type de grille via le header de la capture), reconciliation identique,
  application sur `characters` (`stars`/`awakening`)
- variantes non couvertes par la source (126/258): "Unknown" -> dropdown,
  comme les cas incertains supports

## Risques connus

## Risques connus

- **Lecture du niveau (OCR glyphes)**: la partie la moins validee par le
  spike (l'identite l'est, pas la lecture de texte). Si elle s'avere
  fragile, la reconciliation la rattrape (champ editable) — et le niveau
  est borne par le cap de rarete/LB (`getSupportLevelCap`), utilisable
  comme garde-fou de vraisemblance
- **Bas de grille masque** (barre "Filters"/"Held" par-dessus la derniere
  rangee visible): les gemmes/niveau peuvent etre illisibles sur cette
  rangee -> la detection doit marquer ces cellules "partielles" plutot que
  lire n'importe quoi; l'utilisateur scrolle et re-capture de toute facon
- **Cartes hors catalogue** (nouvelle carte du jeu pas encore importee de
  GameTora): distance au plus proche elevee -> afficher "carte inconnue,
  lancer un update de reference?" plutot qu'un mauvais match confiant

## Ce que ce plan ne fait pas (assume)

- ~~pas d'import des umas~~ — decision revenue, voir Phase E (source
  d'icones trouvee)
- pas de detection generique de grille multi-appareils
- pas de lecture de la rarete/du type sur l'image (inutile, la reference
  les fournit)
- pas de suppression de possession via l'import
