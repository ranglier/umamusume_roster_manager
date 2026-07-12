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

### Apprentissage des associations manuelles — LIVRE

Demande utilisateur apres la phase E: quand une carte non reconnue est
associee manuellement puis appliquee, l'outil memorise l'association.

Principe: l'empreinte de la cellule (le rendu in-game exact de l'appareil de
l'utilisateur — une reference *meilleure* que n'importe quel asset externe)
est stockee sous l'id choisi. Au matching suivant, les empreintes apprises
**ecrasent** la reference pour le meme id -> match a distance ~0. C'est ce
qui couvre progressivement les 126 variantes umas absentes de la source
d'icones, et les futures nouvelles cartes avant toute mise a jour de source.

- apprentissage **au moment d'Apply uniquement** (pas au changement de
  dropdown): on ne memorise que ce que l'utilisateur a confirme
- stockage `localStorage` par mode (`umaSupportImportLearned` /
  `umaCharacterImportLearned`), **non versionne** par `generated_at` (le
  rendu du jeu ne change pas avec les updates GameTora); perdu si les
  donnees navigateur sont videes (persistance serveur = evolution possible)
- le dropdown de correction offre desormais le **catalogue complet** (top-3
  puis separateur puis toutes les cartes triees) — prealable indispensable:
  pour une variante non couverte, la bonne reponse n'etait dans aucun top-3
- garde-fous: note "matched from your earlier correction" sur les lignes
  matchees par apprentissage (une association fausse serait sinon une erreur
  confiante recurrente et invisible), bouton "Forget N learned match(es)"
- verifie en navigateur (cycle complet): association manuelle d'une cellule
  incertaine -> Apply ("Memorized 1 manual match(es)") -> re-import -> la
  cellule matche automatiquement avec la note, "3 to review" passe a 2,
  statut Unchanged (idempotent), zero erreur console

### Phase D — polissage guide par l'usage reel

Seulement apres un premier import complet reel: tolerance d'echelle si
l'utilisateur change de telephone, glyphes 6-9 des niveaux supports (des
qu'une capture en contient), raccourcis UX. Ne rien pre-construire ici.

Livre a la demande:

- **apercu agrandi pour la verification visuelle**: clic sur la vignette
  capturee -> overlay plein ecran avec la capture en resolution native a
  cote de l'image de la carte matchee (illustration pour les supports,
  icone in-game pour les umas couvertes, stand art sinon), fermeture par
  Echap / clic. Prealable: les vignettes sont maintenant capturees en
  resolution native de cellule (~10 Ko/ligne) au lieu de 66px, la table les
  reduit en CSS

Premiere session d'usage reel (retours utilisateur, tous corriges):

- **detection du decalage de scroll par capture** (`detectGridOffsetY`): les
  captures d'une liste scrollee ne tombent pas sur l'origine calibree — la
  grille fixe lisait du garbage sur les fichiers `_02` (29 lignes "a
  verifier" sur 2 captures umas). Detection par identite: minimiser la
  distance dHash des cellules de la premiere rangee contre les references
  (correct par construction; un scoreur "bande claire vs inter-cartes" a
  ete essaye et ecarte — biaise par la luminosite de l'art). Mesure sur les
  10 captures reelles: offsets -1..-31 detectes, distances moyennes 4-11.
  Resultat: 2 captures umas -> "46 distinct, 7 to review" (contre 63/29)
- **lecture du "Potential Lvl" reecrite en NCC masquee par template**: le
  bandeau est translucide et l'art saigne au travers — la NCC pleine boite
  variait de +/-0.3 selon l'art derriere (lectures fausses parfois
  confiantes, ex. "3" lu 4/5 — le bug signale par l'utilisateur). Chaque
  template porte le masque de ses pixels de TEXTE (contour blanc opaque +
  remplissage teinte par famille) et la comparaison ne porte que sur eux.
  Mesure sur 68 cellules reelles: 66/68 top-1, zero erreur confiante, tout
  echec gate. Les masques binarises purs et la NCC sur cartes de contours
  ont ete essayes et ecartes (39/68 et 36/68)
- **vocabulaire**: "Potential" partout dans l'UI d'import (le champ roster
  reste `awakening`, meme chose — nom historique de l'app)
- **echec de sauvegarde honnete** (bug utilisateur "entrees fantomes":
  affichees Owned cote client mais absentes du serveur, projections vides,
  uniques a 0): persistRosterDocument avale ses erreurs dans rosterStatus et
  l'import annoncait "Applied" meme quand le PUT echouait (serveur redemarre
  en cours de session). Desormais: detection de l'echec, resync du roster
  depuis le serveur (les lignes redeviennent proposees/cochees), message
  "NOT saved... apply again", et l'apprentissage n'est memorise qu'apres
  sauvegarde confirmee. Verifie en simulant un PUT injoignable
- **dedup des lignes inconnues par empreinte** (bug utilisateur "doublons
  entre captures qui se chevauchent"): la dedup par id ne couvrait que les
  matchs confiants; les lignes Unknown (variantes non couvertes) etaient
  empilees a chaque capture. Deux cellules du meme appareil montrant la
  meme carte ont des empreintes quasi identiques (d<=6 + intersection
  d'histogrammes >=0.85, les cartes differentes etant a d>=8) -> fusion,
  en preservant un id deja assigne manuellement. Verifie: meme fichier
  importe 2x = zero ligne ajoutee; deux captures chevauchantes = 44
  distinctes pour 70 cellules lues, zero doublon
- **lignes figees dans leur section** (bug utilisateur "la ligne
  disparait"): l'appartenance table principale / section repliee "already up
  to date" est figee au traitement (startedUnchanged) — editer une ligne
  vers les valeurs du roster met a jour son badge de statut mais ne la
  deplace plus en cours de revue
- **valeurs par defaut sures** (regles utilisateur): etoiles bornees 1-5
  (un comptage hors bornes = misread -> defaut 3, flag "a confirmer";
  le serveur rejette stars>5 de toute facon), potential sous le seuil de
  confiance -> defaut 1 au lieu du guess NCC
- **niveau d'unique = etoiles** (regle du jeu): l'import characters
  alimente aussi `unique_level` depuis les etoiles lues (mapping
  stars -> unique_level dans diffFields) — le diff l'affiche ("unique
  1 -> 4") et repare les entrees deja importees au prochain apply
- **layout**: le panneau d'import s'etend sur toute la largeur
  (`grid-column: 1/-1` dans la grille de #list) et le dashboard home passe
  a 1560px centre (la moitie de l'ecran restait vide)

### Phase E — import des umas — LIVREE

Source d'asset: icones in-game par variante du depot `wrrwrr111/pretty-derby`
+ transformation de crop calibree (verdict complet et risques dans
`EXTERNAL_SOURCES_PLAN.md`, "Umas debloquees").
`scripts/fetch_chara_icons.py` telecharge les 132 icones couvertes vers
`dist/media/reference/characters/icons/` (manifest de provenance, validation
de signature PNG, idempotent, separe de `update_reference.py`).

Livre:

- moteur (`roster_import_cv.js`, +9 tests sur fixtures reelles): `UMA_GRID`
  (7x5, origine 45,299, carte 180x230, pas 202x242), `gridCells` parametree
  par grille, boites calibrees en fractions (`icone(28,46,238,227)/256x280`
  <-> `cellule(8,8,172,150)/180x180`), `flattenAlpha` (les coins
  transparents des icones donnaient des RGB arbitraires differents entre
  decodeurs — aplatis deterministiquement avant empreinte),
  `readUmaStars` (comptage de **runs de colonnes dorees** — les centres
  fixes etaient trop fragiles — + detection "masquee par la barre
  Filters/Held" via le ratio de pixels clairs de la bande),
  `readUmaPotential` (= awakening 1-5: **NCC en niveaux de gris** sur boite
  fixe — les masques binarises echouent, l'art saigne a travers la bande
  translucide — avec prefiltre par **teinte du texte** qui encode la
  famille de palier: orange={3,4,5}, bleu-argent={1,2}; gate
  `ncc>=0.6 && marge>=0.15` -> zero erreur confiante mesuree),
  `reconcileFields` (diff generique stars/awakening)
- decouverte de verite terrain en ecrivant les tests: la cellule (3,2) de
  la capture etait une variante NON couverte (mal etiquetee au depart) —
  devenue la fixture qui pinne le comportement "non couvert -> incertain,
  jamais mal matche avec confiance"
- UI (`roster_import.js` refactorise en **config par mode**): presentation
  "Import" sur roster/characters comme sur roster/supports, meme table de
  reconciliation (colonnes Stars / Awakening), application sur
  `characters.stars`/`characters.awakening` via le PUT roster existant —
  `getRosterEntry` fournit les defauts par item (stars = rarete de base),
  donc le diff ne re-signale pas les valeurs elaguees
- verifie en navigateur sur la capture reelle (35 cellules): 32 matchs
  confiants + 3 "a verifier" (top-3 plausibles), variantes alt distinguees
  (Maruzensky ete, les deux McQueen), 1 rangee etoiles masquee detectee et
  signalee, application de 32 umas verifiee cote serveur, re-import ->
  **32 "already up to date", 0 selectionnee** (idempotence), zero erreur
  console. Empreintes: ~46 Ko en localStorage, construites en ~13s une fois

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
