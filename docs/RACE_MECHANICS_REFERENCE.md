# Race Mechanics Reference (base de connaissance du moteur de build)

## Objet et sourcage

Ce document consolide les mecaniques de course d'Umamusume necessaires au futur
moteur de scoring / faisabilite de builds CM (`docs/CM_BUILD_PLAN.md`, phases
3D/3E). Il est le resultat du croisement de trois sources, verifiees l'une
contre l'autre :

- **[MECA]** *Uma Musume Race Mechanics* (KuromiAK, 37 pages) — formules
  exactes issues de reverse engineering. Reference pour tout chiffre.
- **[REF-GL]** *Umamusume Global Reference Document* (Erzzy/Kirei, 198 pages)
  — meta Global, strategie CM, tables empiriques (stamina requise, spurt
  starts), conseils par archetype.
- **[REF-JP]** *Umamusume Reference Document 5th Anniversary* (shory + JP
  veterans, 138 pages) — version JP du precedent ; sert de troisieme voix en
  cas de doute.

Regle de confiance appliquee : sur les 6 mecaniques chiffrees presentes dans
plusieurs sources (formule HP, coefficients de style, seuils de stats caches,
tables d'aptitude, seuils par mood, coefficient de motivation), **toutes
concordent**. L'unique divergence trouvee ("Distance S = +10% Speed", [REF-GL]
p.129, prose de la section CM) est contredite par le propre tableau de
reference de [REF-GL] p.176, lui-meme identique a [MECA] — c'est une erreur de
redaction, tranchee en faveur de +5%.

Les sections de [MECA] marquees "inferred from the game's parameter file" sont
signalees ici par **(speculatif)** : a utiliser comme heuristique, pas comme
verite.

## Conventions

- Styles de course : Front Runner (Nige / runner), Pace Chaser (Senkou /
  leader), Late Surger (Sashi / betweener), End Closer (Oikomi / chaser).
  Oonige = variante extreme du Front Runner. Correspondance avec nos slugs
  d'aptitude `style` : `runner`, `leader`, `betweener`, `chaser`.
- Une course est divisee en **24 sections** d'egale longueur et **4 phases** :
  phase 0 (sections 1-4), phase 1 (5-16), phase 2 (17-20), phase 3 (21-24).
  Ce sont les memes `phases` que notre entite `racetracks` expose deja.
- Le "last spurt" (concept) ne coincide PAS avec la phase 3 : il demarre a
  l'entree de la phase 2 si les HP le permettent (voir plus bas).
- 1 bashin (longueur) = 2.5 m. Tick de simulation = 1/15 s.
- Stats plafonnees a 2000 ; la part au-dela de 1200 est **divisee par 2**
  avant conversion en stat de base.

## Chaine de calcul des stats

```
FinalStat    = AdjustedStat + SkillModifier
BaseStat     = (RawStat + AoharuBonus) * MotivationCoef        # clamp 1..2000
AdjustedSpeed   = BaseSpeed * RaceCourseModifier + GroundModifier(speed)
AdjustedStamina = BaseStamina
AdjustedPower   = BasePower + GroundModifier(power)
AdjustedGuts    = BaseGuts
AdjustedWiz     = BaseWiz * StrategyProficiencyModifier
```

### Coefficient de motivation (mood)

| Mood | Best | Good | Normal | Bad | Worst |
|---|---|---|---|---|---|
| Coef | 1.04 | 1.02 | 1.00 | 0.98 | 0.96 |

### Ground modifier (etat de piste)

Vitesse : -50 sur Turf comme Dirt, uniquement en Heavy (不良).
Power : Turf -50 des Good (稍重) ; Dirt -100 Firm, -50 Good, -100 Soft/Heavy.

(Consommation HP : x1.02 en Heavy ; x1.02 Turf / x1.01 Dirt en Soft.)

### Race course modifier — les "stat thresholds" de nos `racetracks`

Certains parcours ont 1-2 stats seuil (champ `stat_thresholds` deja importe
dans notre schema, jamais exploite). Bonus sur la vitesse ajustee, selon la
**base stat** :

| Base stat | <=300 | 301-600 | 601-900 | >900 |
|---|---|---|---|---|
| Bonus | +0.05x | +0.10x | +0.15x | +0.20x |

S'il y a 2 stats seuil, le modificateur final est la **moyenne** des deux.
Comme le seuil s'applique a la base stat (motivation incluse), les paliers
effectifs en raw stat bougent avec le mood : 290/578/867 en Best, 314/627/939
en Worst.

## Aptitudes — les 4 tables exactes

Ce sont les multiplicateurs reels du moteur ([MECA] ; confirmes en % par
[REF-GL] p.176). A utiliser tels quels dans le scoring, a la place des buckets
S/A binaires actuels de `getCharacterAptitudeForTarget`.

| Grade | S | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|---|
| Surface -> acceleration | 1.05 | 1.0 | 0.9 | 0.8 | 0.7 | 0.5 | 0.3 | 0.1 |
| Distance -> vitesse (phases 2-3) | 1.05 | 1.0 | 0.9 | 0.8 | 0.6 | 0.4 | 0.2 | 0.1 |
| Distance -> acceleration | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.6 | 0.5 | 0.4 |
| Style -> Wiz | 1.1 | 1.0 | 0.85 | 0.75 | 0.6 | 0.4 | 0.2 | 0.1 |

Points structurants pour le moteur :

- L'aptitude Distance a **deux effets separes** : la vitesse chute des B, mais
  l'acceleration reste intacte jusqu'a D. Un B en distance est genant, pas
  fatal ; un E est catastrophique sur les deux tableaux.
- L'aptitude Style ne touche que le Wiz — donc l'activation de skills, le
  position keep et la randomness, PAS la vitesse brute. [REF-GL] : ordre de
  grandeur, un ecart de +5%/-10% d'aptitude equivaut a environ +120/-230
  points de stat autour de 1200.
- [REF-GL] "How to Win" : viser S en distance est un vrai avantage
  competitif en CM (+5% vitesse en fin de course, la ou tout se joue).

## Vitesse

```
BaseSpeed = 20.0 - (CourseDistance - 2000)/1000   [m/s]
```

### Vitesse cible de base par phase

Phases 0-1 : `BaseTargetSpeed = BaseSpeed * StrategyPhaseCoef` — la stat Speed
n'a **aucun effet** en debut/milieu de course.

Phases 2-3 :
```
BaseTargetSpeed = BaseSpeed * StrategyPhaseCoef
                + sqrt(500 * SpeedStat) * DistanceProficiency * 0.002
```

| Style | Phase 0 | Phase 1 | Phases 2-3 |
|---|---|---|---|
| Front Runner | 1.000 | 0.980 | 0.962 |
| Pace Chaser | 0.978 | 0.991 | 0.975 |
| Late Surger | 0.938 | 0.998 | 0.994 |
| End Closer | 0.931 | 1.000 | 1.000 |
| Oonige | 1.063 | 0.962 | 0.950 |

### Last spurt (calcul deterministe — cle pour le moteur)

Calcule au debut de la phase 1, sans randomness :

```
LastSpurtSpeedMax = (BaseTargetSpeed_phase2 + 0.01*BaseSpeed) * 1.05
                  + sqrt(500*SpeedStat) * DistanceProficiency * 0.002
                  + (450*GutsStat)^0.597 * 0.0001
```

A l'entree de la phase 2 : si les HP suffisent pour courir le reste a cette
vitesse, le spurt demarre immediatement a plein regime. Sinon, le jeu genere
des candidats (vitesse -0.1 m/s par pas) tries par temps d'arrivee, et chaque
candidat passe un test `15 + 0.05*WizStat [%]` — un Wiz faible choisit plus
souvent un spurt sous-optimal. Une recovery declenchee apres l'entree en
phase 2 recalcule le spurt ; un debuff ne le recalcule pas.

Consequence directe pour le moteur (palier 2) : **la position du debut de
spurt est calculable** a partir des stats du build et de la geometrie du
parcours — c'est exactement la donnee que [REF-GL] "Analyzing Tracks" et sa
table "G1 Track Spurt Starts" exploitent a la main pour decider quels skills
d'acceleration fonctionnent sur une piste.

### Randomness par section

A chaque section, la vitesse cible recoit `BaseSpeed * random(Min..Max)` ou
`Max = WizStat/5500 * log10(WizStat*0.1) [%]` et `Min = Max - 0.65 [%]`.
Exemples : 400 Wiz -> [-0.533%, +0.117%] ; 800 Wiz -> [-0.373%, +0.277%].
Pas de randomness pendant le last spurt. Le Wiz reduit donc surtout la
variance negative.

## Acceleration

```
Accel = BaseAccel * sqrt(500 * PowerStat)
      * StrategyPhaseCoef(accel) * GroundTypeProficiency * DistanceProficiency(accel)
      + SkillModifier + StartDashModifier
BaseAccel = 0.0006 m/s^2   (0.0004 en montee)
```

| Style | Phase 0 | Phase 1 | Phases 2-3 |
|---|---|---|---|
| Front Runner | 1.000 | 1.0 | 0.996 |
| Pace Chaser | 0.985 | 1.0 | 0.996 |
| Late Surger | 0.975 | 1.0 | 1.000 |
| End Closer | 0.945 | 1.0 | 0.997 |
| Oonige | 1.170 | 0.94 | 0.956 |

Start dash : +24 m/s^2 jusqu'a `0.85 * BaseSpeed`. Depart : 3 m/s. Delai de
depart aleatoire 0-0.1 s, **non affecte par le Wiz** ; >0.08 s = late start.
Skills : Concentration x0.4, Focus x0.9 sur ce delai.

### Pentes

- Montee : perte de vitesse cible `SlopePer * 200 / PowerStat` — la Power
  compense les montees (notre champ `slopes[].slope` = SlopePer x100... a
  verifier contre les donnees ; SlopePer > 1.0 = uphill, < -1.0 = downhill).
- Descente : chaque seconde, chance `WizStat * 0.04%` d'entrer en mode
  "downhill accel" (+0.3 + SlopePer/10 m/s, consommation HP x0.4 ; 20% de
  chance d'en sortir par seconde).

## HP / Stamina

```
MaxHP = CourseDistance + 0.8 * StrategyCoef * StaminaStat
```

| Style | Front | Pace | Late | End | Oonige |
|---|---|---|---|---|---|
| StrategyCoef | 0.95 | 0.89 | 1.00 | 0.995 | 0.86 |

```
HPParSeconde = 20 * (CurrentSpeed - BaseSpeed + 12)^2 / 144
             * StatusModifier * GroundModifier
```

StatusModifier : x1.6 rushed, x0.6 pace-down, x0.4 downhill accel mode.
En phases 2-3, s'ajoute `GutsModifier = 1 + 200/sqrt(600*GutsStat)`
(200 Guts -> x1.577 ; 600 -> x1.333) : le Guts reduit la consommation en fin
de course. A sec : vitesse cible = vitesse minimale
(`0.85*BaseSpeed + sqrt(200*Guts)*0.001`) — c'est l'effondrement visible.

Recoveries : gold +5.5% des MaxHP, blanc +1.5%, unique 3.5% (<3 etoiles) ou
5.5%. Debuffs stamina : gold -3%, blanc -1% (multiples cumulables).

### Stamina requise par distance ([REF-GL], mesures umalator)

Conditions : 1200 Speed / 1200 Power / 600 Wit, pas de descentes, Guts 300
(Sprint/Mile) ou 400 (Med/Long).

| Distance | Front | Pace | Late | End |
|---|---|---|---|---|
| Sprint 1400m | 570 | 540 | 500 | 510 |
| Mile 1800m | 800 | 770 | 720 | 740 |
| Mile 1800m + 1 gold | 640 | 600 | 560 | 580 |
| Mid 2400m + 1 gold | 910 | 930 | 870 | 900 |
| Mid 2400m + 2 golds | 710 | 720 | 680 | 700 |
| Long 2600m + 1 gold | 1130 | 1110 | 1030 | 1060 |
| Long 2600m + 2 golds | 900 | 870 | 820 | 850 |
| Long 3200m + 2 golds | 1080 | 1060 | 990 | 1020 |
| Long 3200m + 3 golds | 830 | 800 | 750 | 780 |

Les descentes reduisent le besoin (ex. Hanshin 3000m ~ -150 vs Kyoto 3000m).
En CM, prevoir une marge : les debuffers y sont frequents (une Nice Nature
bien construite retire plus qu'une gold recovery).

### Cout d'opportunite Stamina vs Speed ([REF-GL], 100 courses 1v1)

- ~100 sous la reco : 1 point de Stamina vaut ~3 points de Speed.
- ~300 sous la reco : la Speed ne compense plus du tout (1200 Speed / 350
  Stamina perd contre 470 Speed / 500 Stamina en Sprint).
- Au-dessus de la reco : gain quasi nul (sauf assurance anti-debuff/rushed),
  a l'exception du seuil 1200 en Mid/Long (voir Stamina Limit Break).

### Fiabilite des recoveries selon le Wiz ([REF-GL])

| Wit | 300 | 500 | 700 |
|---|---|---|---|
| 1 gold activee | 70.0% | 82.0% | 87.1% |
| 2 golds activees | 49.0% | 67.2% | 75.9% |
| 3 golds activees | 34.4% | 55.1% | 66.1% |

Chaque gold supplementaire "requise" par le plan stamina degrade la
consistance ; prendre N+1 recoveries pour n'en exiger que N est la parade
(ex. "2 of 3" a 500 Wit = 91.4%).

### Seuil de bascule Guts <-> Stamina ([REF-GL])

En dessous du seuil, +1 Guts vaut plus que +1 Stamina ; au-dessus, moins :
Sprint 210 / Mile & Dirt 260 / Medium 320 / Long 3000m 380 / 3600m 440.

## Skills

### Chance d'activation (test unique avant course)

```
ActivationChance = max(100 - 9000/BaseWiz, 20) %
```
300 Wiz -> 70% ; 600 -> 85% ; 900 -> 90% ; 1200 -> 92.5%. Base Wiz = avant
StrategyProficiency — donc l'aptitude Style ne joue PAS ici, contrairement a
une idee recue. Les skills passifs (greens) passent le meme test.

### Duree et cooldown

`Duration = BaseDuration * CourseDistance/1000` — un skill de 3 s dure 7.2 s
sur 2400 m. Idem cooldown. Consequence scoring : la valeur absolue d'un skill
de vitesse croit lineairement avec la distance de course.

### Niveaux de skill (montee via cartes/eveil)

| Niveau | 1 | 3 | 5 | 7 | 10 |
|---|---|---|---|---|---|
| Vitesse cible | 1.00 | 1.04 | 1.10 | 1.16 | 1.25 |
| Acceleration | 1.00 | 1.04 | 1.08 | 1.125 | 1.20 |
| Recovery / autres | 1.00 | 1.04 | 1.08 | 1.12 | 1.18 |

### Conditions d'activation — precisions moteur

Complements a ce que `visualizer.js` sait deja :

- `x_random` : un segment de 10 m est tire AVANT la course ; le skill part
  quand l'uma y passe (et que les autres conditions tiennent).
- `straight_random` : chaque ligne droite a une chance egale d'etre tiree,
  **independamment de sa longueur** — puis segment de 10 m dedans.
- `corner_random` : si le meme virage est couru plusieurs fois (multi-tours),
  activation au dernier tour.
- `all_corner_random` : jusqu'a 4 triggers distribues sequentiellement le
  long des virages (algorithme detaille dans [MECA] p.14-15).
- `phase_corner_random` : les virages de la phase sont "recolles" — la
  probabilite est proportionnelle a la longueur, contrairement a
  `straight_random`.
- `order_rate` : converti en place absolue arrondie au plus proche
  (`order_rate>50` sur 9 partants = `order>5`, donc 6e ou pire).
- `remain_distance` : compare a la position arrondie a l'entier inferieur.

### Valeur relative des familles de skills ([REF-GL] "How to Win")

Ordres de grandeur mesures (2400 m, conditions standard) :

| Famille | Gain typique |
|---|---|
| Accel blanche (ou unique herite d'accel) | +6.0 m |
| Accel gold (ou unique natif d'accel) | +9.2 m |
| Speed blanche | +1.4 m |
| Speed gold | +3.2 m |
| Gold speed 3 s (1600 m) | +1.68 m |
| Unique accel Seiun Sky (1600 m) | +10.3 m |

**L'acceleration au bon moment domine tout le reste.** Le "bon moment" est le
debut du last spurt (passage ~20 -> ~25 m/s : ~11 s d'acceleration naturelle a
1000 Power ; chaque seconde gagnee ~ 1+ bashin). D'ou la question centrale du
scoring de skills : *le trigger du skill couvre-t-il la position de debut de
spurt calculee ?*

Methode de calcul exacte pour un skill d'accel ([REF-GL] p.183) :
`t = (Vtop - Vdepart)/Accel`, distance parcourue `0.5*t*(Vtop+Vdepart)`,
comparer avec/sans le bonus d'accel du skill — reimplementable telle quelle.

Spurt speed carry-over : un skill de vitesse **actif au moment ou le spurt
demarre** releve la borne haute de vitesse pendant toute l'acceleration —
gain reel superieur a sa duree nominale. Bonus non negligeable pour les
skills de vitesse dont la zone couvre juste avant le spurt start.

### Distribution des spurt starts sur les G1 ([REF-GL] p.133)

Sur les pistes G1 (d'ou viennent les CM) : spurt demarrant sur un virage
76.7% (dont final corner 63.3% ; "very late" 23.3%), sur une ligne droite
23.3% (dont finale 13.3%). Tous les Mile/Medium G1 demarrent sur un virage,
tous les Long G1 sur une ligne droite. La table par piste (Nakayama 1200m ->
"Late Final Corner", Tokyo 2400m -> "Just before Final Corner", etc.) est
recuperable par calcul palier 2 plutot que par table figee.

## Mecaniques a seuil de stat (importantes pour les targets de stats)

- **Charge Up / Conserve Power (speculatif)** : base Power + skills > 1200
  -> boost d'acceleration au debut du last spurt
  (`sqrt((Power-1200)*130)*0.001 * coef`), coef par style x distance (Front
  1.0 partout ; Pace 0.7-0.9 ; Late 0.7-1.0 ; End 0.7-0.9). Duree ~3 s.
- **Stamina Limit Break (speculatif)** : base Stamina + skills > 1200 ET
  distance >= 2101 m -> buff de vitesse cible a l'atteinte de la vitesse max
  de spurt (`sqrt(Stamina-1200)*0.0085*DistFactor`), DistFactor : 0 sous
  2101 m, 0.5 (2101-2200), 1.0 (2201-2400), 1.5 (2401-2600), 1.8 (2601+).
  C'est la justification du "1200+ Stamina" en Long.
- **Dueling (final straight, speculatif)** : bonus vitesse/accel en
  `Guts^0.708 / Guts^0.59` quand deux umas restent proches >2 s sur la ligne
  droite finale ; impossible sous 15% HP. Le Guts gagne les photo-finish.
- **Lead competition (debut de course, Front/Oonige, speculatif)** : bonus en
  Guts^0.6 mais consommation HP x1.4 (x3.6 si rushed) — deux Front Runners
  qui se disputent la tete se ruinent mutuellement la stamina.

## Position keep, pacemaker, rushed (resume utile)

- Position keep : sections 1-10. Front Runner : modes speed-up/overtake
  (checks Wiz `20*log10(Wiz*0.1)%`). Autres styles : pace-up/pace-down par
  rapport au pacemaker, bornes par style (Pace 3-5 m, Late 6.5-7 m, End
  7.5-8 m, x un facteur de longueur de course).
- **Rushed** : roll avant course, `(6.5/log10(0.1*Wiz+1))^2 %` — 300 Wiz ->
  19%, 900 -> 11%, 1200 -> 9.7%. HP x1.6 pendant l'effet. Deuxieme grand role
  defensif du Wiz avec l'activation de skills.
- Un Front Runner seul en course performe moins bien (seuils de speed-up plus
  larges) ; les guides d'equipe CM en tiennent compte ([REF-GL] "Making a
  Team").

## Champions Meeting — specificites produit

- **Brackets** : Graded League (toute uma) vs Open League (rang B ou pire
  uniquement, choix irrevocable). Les recompenses Graded >> Open (3e en
  Graded finals ~ 1er en Open finals). Le rang d'une uma = stats + skills
  (les aptitudes S ne coutent AUCUN point de rang — d'ou les builds Open
  "S partout, peu de skills, stats max sous le seuil B"). Formule exacte du
  rang non presente dans nos sources (calculateurs externes existants).
- 3 umas par equipe, meme piste pour toute l'edition -> specialisation
  extreme rentable : greens situationnels (+40 vitesse chacun, ex.
  Left-Handed + saison) deviennent sur-actives a 100%.
- Le trio type decrit par [REF-GL] : 2 racers + 1 debuffer est une strategie
  courante ; statline debuffer ~500/300/900/300/1200 (seul le Wiz compte,
  et Power pour suivre le peloton). Debuffs speed gold -0.25 m/s, "Hesitant"
  -0.15 m/s ; toujours utiles car sans condition d'echec.
- Strategie par style (base de regles curee [REF-GL] "How to Win", a encoder
  progressivement) :
  - Front Runner : Groundwork + greens x3 (trigger 100%) ; unique Seiun Sky
    si le spurt demarre sur un virage ; Wiz eleve prioritaire.
  - Pace Chaser : accels sur final corner (Maruzensky/Taiki si spurt tot dans
    le virage, Nishino Flower si tard) ou final straight (Nishino, H.Creek).
  - Late Surger : accels nombreuses mais inconsistantes (On Your Left!,
    uniques Ryan/Dober — exigent 5e/6e place) ; en stacker un maximum.
  - End Closer : comme Late Surger + Encroaching Shadow (accel sur ligne
    droite pendant le spurt — excellent si le spurt demarre sur une droite).

## Legacy / heritage (pour le scoring de parents)

- Sparks obtenues en fin de run : blue = stat aleatoire parmi 5, etoiles
  selon la valeur (<600 : ~90/10/0% pour 1/2/3 etoiles ; 600-1100 :
  ~50/45/6% ; >1100 : ~20/70/10%). Pink = tiree parmi les aptitudes A+ (ne
  pas monter d'aptitudes inutiles a A si on cible une pink precise).
- Montee d'aptitude a l'heritage initial : 1 etoile pour le premier rang,
  puis 3 par rang supplementaire, max +4 rangs. (Ex. E -> A = 10 etoiles de
  pinks cumulees parents+grands-parents.)
- Chances d'heritage par spark (x (1 + affinite%)) : blue 70/80/90% selon
  etoiles ; pink 1/3/5% ; green (unique) 5/10/15% ; race whites 1/2/3% ;
  autres whites 3/6/9%.
- White sparks en fin de run : 20% par skill blanc appris, 25% par ◎, 40%
  par gold (+2.5%/+5% par parent/grand-parent portant deja la spark).
- Enseignement pragmatique [REF-GL] "Preparing For CM (For Lazy People)" :
  un seul parent maison avec un bon unique + pink 2 etoiles de la bonne
  distance suffit largement ; +50 stats de sparks ne changent pas un winrate.

## Application au moteur du projet

### Palier 1 — formules directes (aucune simulation)

Calculable immediatement depuis `characters` + `racetracks` + `cm_targets` +
roster :

- fit d'aptitude reel (4 tables ci-dessus) au lieu du bucket binaire actuel
  de `getCharacterAptitudeForTarget` — y compris le style, absent aujourd'hui
- HP max et verdict stamina vs table des recommandations (par style, avec
  comptage des recoveries du package de skills et leur consistance selon Wiz)
- bonus de seuil de stats (`stat_thresholds` de la piste, deja importe)
- % d'activation de skills et de rushed depuis le Wiz projete
- seuil Guts par distance ; seuils 1200 Power / 1200 Stamina comme targets

### Palier 2 — projection deterministe du spurt

Reimplementer le calcul du last spurt (formules ci-dessus) pour situer le
debut de spurt en metres sur la geometrie `racetracks`, puis croiser avec les
zones du Skill Visualizer : un skill d'accel dont la zone couvre le spurt
start vaut ~6-10 m ; un skill de vitesse en phase 2+ vaut ~1.4-3.2 m (x
distance/1000) ; un skill hors zone vaut ~0. La methode de chiffrage
([REF-GL] p.183) est reimplementable telle quelle.

### Palier 3 — hors perimetre v1

Simulation multi-agents (position keep detaille, blocking, lanes, pacemaker,
dueling) = le territoire de l'umalator (GPL, non copiable). Les regles
"speculatif" ci-dessus y appartiennent aussi pour leur part fine. A garder
comme horizon, conformement a `docs/CM_BUILD_PLAN.md` Option D.

### Donnees manquantes dans notre referentiel — mises a jour

Trois manques identifies plus haut ont ete creuses apres redaction initiale de
ce document:

**1. Effets chiffres des skills — partiellement resolu, moins grave que
redoute.** Verification faite: `condition_groups[].effects[].{type, value}`
et `base_time` sont deja presents tels quels dans notre `skills` normalise
(ex. Groundwork: `{"base_time": 30000, "effects": [{"type": 31, "value":
2000}]}`). Ce ne sont donc pas des donnees absentes, mais des donnees brutes
non interpretees:
- unite: diviser par 10000 donne les valeurs humaines ([REF-GL]
  "Groundwork - 0.2 over 3s" = value 2000/10000 = 0.2, base_time 30000/10000
  = 3.0s — confirme).
- semantique du `type` (quel effet — vitesse cible, acceleration,
  recovery...): **pas de table officielle publiee par GameTora**. [MECA]
  documente completement seulement 2 "Ability" (CurrentSpeed=21,
  CurrentSpeedWithNaturalDeceleration=22) et une liste separate de "Value
  Scaling" (Direct=1, MultiplySkillNum=2, etc., IDs 1-25) qui n'est PAS le
  meme espace d'IDs que celui vu dans les donnees reelles (Groundwork a
  type=31, absent de cette liste). [MECA] mentionne neanmoins, dans une
  section annexe (Conserve Power), que les types **21, 22, 27, 31** forment
  ensemble la famille "Speed Up" et le type 28 la famille "Lane Move Speed
  Up" — coherent avec Groundwork (accel) = type 31. Rester prudent: decoder
  chaque type demanderait de recouper systematiquement description de skill
  <-> type observe, un vrai projet de retro-ingenierie a part entiere, pas
  fait ici.
- Import ajoute au passage: `static/skill_conditions` (nouveau dataset
  GameTora, 141 entrees), qui donne la description officielle ET les enums
  exacts de chaque variable de condition (confirme `season` a bien 5 valeurs
  — 4 saisons + "cherry blossom" — `weather`, `running_style`,
  `distance_type`, `ground_type`, `ground_condition`). Deja cable dans
  `normalize_skills()` (`references.condition_descriptions`) et dans
  `visualizer.js` (`describeDynamicTermHuman` gere maintenant ces enums avec
  la vraie source au lieu de les laisser en texte brut).

**2. La formule de rang (Open vs Graded League) — structure connue, formule
exacte introuvable.** Le dataset `db-files/single_mode_rank` (importe,
298 paliers) donne les **bornes de points par rang** (ex. id 1 = 0-299, id 2
= 300-599...), mais pas la formule qui transforme stats+skills en points.
Recherche externe (calculateurs communautaires, pas GameTora): `Total =
somme non-lineaire des stats (favorise la concentration sur peu de stats
plutot que l'egalisation) + bonus unique (multiplicateur par palier
d'etoiles) + somme des points de skills selectionnes`. Les tables exactes
(point par valeur de stat, point par skill) n'existent que dans des
calculateurs tiers non officiels — non reproduites ici en l'absence de
source primaire fiable.

**3. Les valeurs de `stat_bonus` de scenario/mood au moment du run** restent
hors perimetre du referentiel: ce sont des donnees d'etat d'une run en cours
(profil utilisateur), pas des donnees canoniques GameTora.

## Limites connues de ce document

- Les tables empiriques [REF-GL] (stamina requise, spurt starts G1) datent de
  l'etat du jeu a leur redaction ; les formules [MECA] mentionnent plusieurs
  changements d'equilibrage historiques (1st/1.5th anniversary) — le jeu peut
  encore changer.
- Les sections marquees (speculatif) viennent du fichier de parametres du
  jeu, pas du code decompile.
- Aucun de ces documents ne couvre la formule de rang d'uma ni le matchmaking
  CM.
