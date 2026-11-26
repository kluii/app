# Klui 2.0 — dossier de specs

Ce dossier contient les fichiers à déposer dans le repo `klui` (l'app, pas `klui-site`) avant de lancer l'agent de code.

## Où copier quoi

```
klui/
├── PROMPT.md                  ← à la racine. C'est le prompt à donner à l'agent.
├── ROADMAP.md                 ← à la racine
├── DESIGN.md                  ← à la racine
├── AGENTS.md                  ← à la racine (working agreement, lu en premier)
├── assets/
│   ├── light-logo.png         ← ton fichier (encre blanche, pour fond sombre)
│   └── dark-logo.png          ← ton fichier (encre noire #0C0C0C, pour fond clair)
└── docs/
    ├── decisions.md           ← registre des décisions verrouillées (à lire avant de coder)
    ├── architecture.md
    ├── api.md
    ├── mcp.md
    ├── permissions.md
    ├── security.md
    ├── deployment.md
    ├── testing.md
    ├── adr/0000-template.md
    ├── verify/_TEMPLATE.md
    └── features/
        ├── board-interaction.md
        ├── realtime.md
        ├── auth.md
        ├── links-and-anonymous.md
        ├── agents.md
        ├── digest.md
        ├── import-export.md
        ├── i18n.md
        └── close-out.md
```

Le dossier `features/` correspond exactement aux chemins cités dans `PROMPT.md` et `ROADMAP.md`. Ne renomme pas les fichiers : les documents se citent entre eux par chemin.

## Ordre de lecture pour l'agent

1. `AGENTS.md`
2. `PROMPT.md`
3. `ROADMAP.md`
4. `DESIGN.md`
5. `docs/decisions.md`
6. `docs/architecture.md` → `permissions.md` → `api.md` → `mcp.md` → `security.md` → `testing.md`
7. `docs/features/<la feature de la tâche en cours>`

## Ce qui est décidé ici et qui n'était pas dans le brief

Tout est dans `docs/decisions.md` (D-01 à D-53), avec la raison et l'ADR à écrire. Les cinq qui changent le plus le code :

- L'admin d'instance n'a **aucun** accès au contenu des boards (D-06) : un rôle ops qui lit tous les tableaux privés rend le 404 menteur.
- Les tags **sont colorés** (D-21) : couleur par carte avec défaut au niveau du board, teinte plafonnée et libellé en encre pour que n'importe quel hex reste lisible (pire cas mesuré 8,9:1 en dark, 13,9:1 en light).
- Aucune **expiration ni archivage automatique** des boards (D-53) : un board se termine quand son propriétaire le ferme explicitement, ou se supprime. Pas de `archive_after_days`, pas de balayeur qui retire des tableaux.
- Les acteurs anonymes ont un cookie signé + `anon_actor_id` (D-11), sinon « modifier la carte que je viens de créer » n'est pas implémentable sans compte.
- Un lien `edit` ne peut **pas supprimer** (D-09) : un token révocable qui détruit le travail rend chaque lien partagé risqué.
- La fermeture d'un board est irréversible en 2.0 (D-22) : l'export est la porte de sortie, pas un bouton « rouvrir ».

## Deux pièges d'assets

`light-logo.png` = encre **blanche** (à poser sur le dark). `dark-logo.png` = encre **noire** (à poser sur le light). Le nom du fichier décrit l'encre, pas le thème — c'est documenté dans `DESIGN.md` §13 pour que l'agent ne l'inverse pas.

Les deux logos sont des carrés 1:1 sans fond. Tailles d'usage : 24 px dans la barre, 32 px sur les pages auth, 48 px sur le 404 et le bilan de clôture. Jamais sous 20 px, jamais au-dessus de 64 px.

## Avant de lancer l'agent

1. Vérifie que `assets/` contient bien les deux PNG et que le repo est vide par ailleurs.
2. Commit ce dossier sur `dev` (pas `main`) : l'agent doit pouvoir citer des chemins réels.
3. Donne-lui `PROMPT.md`, pas ce README. Ce README est pour toi.
4. Attends de lui `docs/verify/k0.md` avant de le laisser entamer K1 : c'est là qu'on voit s'il a réellement fait tourner la CI ou s'il a déclaré un vert qu'il n'a pas observé.

## Ce que ce dossier ne contient pas

- La landing, les docs publiques, le blog, les mentions légales : repo `klui-site`, hors périmètre.
- Les prix de l'offre hébergée : décision produit, pas code.
- Un export `klui.export/v1` réel : c'est l'item ouvert O-01 de `docs/decisions.md`. Sans ce fichier, l'importeur v1 est écrit d'après l'annexe du brief et doit être annoncé comme non vérifié sur un vrai fichier.
