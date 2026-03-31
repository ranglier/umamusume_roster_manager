# Umamusume Roster Manager

Umamusume Roster Manager is a local companion app for `Umamusume Pretty Derby`.

The project is built to help you:

- browse a structured local reference of the game
- manage your own `characters`, `supports` and `legacy / parent` inventory
- work offline once the local data has been generated
- prepare the ground for future Champions Meeting build tools

It is designed as a personal workstation rather than a public website: you generate the data locally, keep your own profiles locally, and use the app through a small local web server.

## What The Project Covers Today

The current app already includes:

- a local game reference for:
  - `characters`
  - `supports`
  - `skills`
  - `races`
  - `racetracks`
  - `g1_factors`
  - `compatibility`
  - `cm_targets`
  - `scenarios`
  - `training_events`
- local profiles
- a first-start wizard
- a local administration page for updates, backups and profile management
- `My Roster` for owned `characters` and `supports`
- a `Legacy / Parent` inventory
- a first local inheritance simulator

The long-term target is broader than a reference browser: the project is progressively moving toward a real local environment for inheritance work, roster management, race analysis and, later, CM build support.

## Main Ideas Behind The Project

### Local-first

The app does not rely on GameTora at runtime.

Data is imported first, normalized locally, then served from your machine. Once the reference has been generated, browsing and roster usage do not depend on the external site.

### Personal workspace

This is not only a read-only reference.

The app also keeps personal data locally:

- profiles
- owned cards
- progression fields
- local tags and organization
- legacy parents and lineage data

### Built for future CM workflows

The current scope already prepares future features such as:

- better inheritance simulation
- race and skill visualizers
- build feasibility checks
- CM-oriented tooling

## Application Areas

### Catalog

`Catalog` is the exploration side of the app.

It lets you browse the local reference, inspect details, filter data and navigate between linked entities.

### My Roster

`My Roster` is the personal side of the app.

It lets you manage:

- owned `characters`
- owned `supports`
- `legacy / parents`

This is where progression, local organization and inheritance work happen.

### Legacy / Parent

The `Legacy` section is meant to support real parent management on your account.

It already includes:

- parent inventory
- direct sparks
- embedded grandparents
- an inheritance preview simulator

This part is still evolving, but it is already positioned as the bridge between simple roster management and future CM build tooling.

## How To Use The Project

After cloning the repository, generate the local reference and start the local server.

Update the reference:

```bash
python ./scripts/update_reference.py
```

Start the app:

```bash
python ./scripts/serve_reference.py --open
```

Local URL:

```text
http://127.0.0.1:8000/
```

On a fresh setup:

1. run the local update
2. open the app
3. create or select a profile
4. start using `My Roster` and `Catalog`

## Why The Repository Stays Light

Imported GameTora data, generated local assets and user data are intentionally kept out of Git.

The repository mainly contains:

- the importer
- the local server
- the frontend
- the local data model
- the project documentation

That keeps the project portable while leaving each user free to generate and keep their own local workspace.

## Project Documentation

The `README` is intentionally presentation-focused.

Technical details, implementation notes and forward plans live in the docs:

- [Project Status](docs/PROJECT_STATUS.md)
- [CM Build Plan](docs/CM_BUILD_PLAN.md)
- [External Sources Plan](docs/EXTERNAL_SOURCES_PLAN.md)

These documents cover the deeper technical and architectural aspects of the project.

## Current Direction

The next major areas of work are:

- improving the `Legacy / Parent` workflow and simulator
- introducing local `Visualizers` for races and skill activation
- preparing the data and UI layers needed for future CM build support

The project is already usable as a local reference and roster manager, but it is also being shaped as a stronger personal analysis tool for Umamusume.
