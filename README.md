# Ledge — Réconciliation Bancaire Locale

Application web monopage de **réconciliation bancaire locale** (client-side only). Elle permet de rapprocher automatiquement des transactions bancaires extraites de relevés PDF avec des justificatifs (factures, tickets de caisse) importés sous forme de PDF ou d'images, en s'appuyant sur l'OCR et l'analyse de contenu.

**Aucune donnée ne transite par un serveur** — tout le traitement (parsing PDF, OCR, réconciliation) s'exécute dans le navigateur. Les données sont persistées en `localStorage`.

---

## Table des matières

- [Architecture Technique](#architecture-technique)
- [Structure des fichiers](#structure-des-fichiers)
- [Modèle de Données](#modèle-de-données)
- [Fonctionnalités Détaillées](#fonctionnalités-détaillées)
- [Interface Utilisateur](#interface-utilisateur)
- [Design System](#design-system)
- [Flux Utilisateur Principaux](#flux-utilisateur-principaux)
- [Statistiques Calculées](#statistiques-calculées)
- [Filtrage et Navigation](#filtrage-et-navigation)
- [Gestion des Erreurs](#gestion-des-erreurs)
- [Limites et Contraintes](#limites-et-contraintes)
- [Tests](#tests)
- [Développement Local](#développement-local)

---

## Architecture Technique

### Stack technologique

| Couche | Technologie |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 + design tokens HSL dans `index.css` |
| Composants UI | shadcn/ui (Radix UI) |
| Animations | Framer Motion 11 |
| PDF parsing | pdfjs-dist 4.4.168 (worker via CDN) |
| OCR | Tesseract.js 7 (langues : `fra+eng`) |
| Export Excel | xlsx (SheetJS) 0.18 |
| Export PDF | jsPDF 4.2 + jspdf-autotable 3.8 |
| Routing | React Router DOM 6 |
| Notifications | Sonner |
| Typographie | Geist + Geist Mono (Google Fonts) |
| Tests | Vitest + Testing Library + Playwright |

### Persistance

| Clé localStorage | Contenu |
|---|---|
| `ledge_transactions` | `Transaction[]` sérialisées en JSON |
| `ledge_receipts` | Métadonnées `Receipt[]` (sans les fichiers binaires) |
| `ledge_personal_expenses` | `PersonalExpense[]` sérialisées en JSON |

> ⚠️ Les fichiers binaires (PDF, images) ne sont **pas** persistés — ils sont conservés en mémoire (blobs) pendant la session uniquement. Seuls les noms de fichiers et les IDs sont sauvegardés.

---

## Structure des fichiers

```
src/
├── pages/
│   ├── Index.tsx              # Page principale (layout, orchestration)
│   └── NotFound.tsx           # Page 404
├── hooks/
│   └── useLedger.ts           # Hook central — état, logique métier
├── lib/
│   ├── types.ts               # Types TypeScript (Transaction, Receipt, PersonalExpense)
│   ├── store.ts               # Persistence localStorage
│   ├── pdf-parser.ts          # Extraction structurée de texte depuis PDF bancaires
│   ├── receipt-scanner.ts     # Pipeline OCR (images + PDF justificatifs)
│   ├── receipt-ocr-utils.ts   # Extraction montants/dates depuis texte OCR
│   ├── reconciliation.ts      # Algorithme d'auto-réconciliation
│   ├── export.ts              # Export Excel/PDF + Import Excel
│   └── utils.ts               # Utilitaires (cn)
├── components/
│   ├── TransactionTable.tsx   # Tableau des transactions bancaires
│   ├── PersonalExpenseTable.tsx # Tableau des dépenses personnelles
│   ├── DetailPanel.tsx        # Panneau latéral détail transaction
│   ├── PersonalExpensePanel.tsx # Panneau ajout dépense personnelle
│   ├── SidebarFilter.tsx      # Filtres latéraux (statut/type)
│   ├── Dropzone.tsx           # Zone drag & drop d'import
│   ├── MonthSelector.tsx      # Sélecteur de mois
│   ├── StatementSelector.tsx  # Sélecteur de relevé source
│   ├── ExportBar.tsx          # Boutons export/import
│   └── ui/                    # Composants shadcn/ui
└── App.tsx                    # Routing + providers
```

---

## Modèle de Données

### Transaction (opération bancaire)

```typescript
interface Transaction {
  id: string;                    // UUID v4
  date: string;                  // Format dd/mm/yy ou YYYY-MM-DD
  label: string;                 // Libellé de l'opération
  amount: number;                // Montant absolu (toujours positif)
  type: 'credit' | 'debit';     // Sens de l'opération
  status: 'pending' | 'matched' | 'auto-matched' | 'personal';
  receiptId?: string;            // ID du justificatif lié
  reconciliationNote?: string;   // Note de réconciliation automatique
  validationComment?: string;    // Commentaire si validé sans justificatif
  raw: string;                   // Ligne brute extraite du PDF
  statementSource?: string;      // Nom du fichier PDF source
}
```

### Receipt (justificatif)

```typescript
interface Receipt {
  id: string;
  name: string;                  // Nom du fichier original
  file: File;                    // Objet File (non persisté)
  thumbnailUrl: string;          // URL blob pour aperçu
  linkedTransactionId?: string;  // Transaction liée
  createdAt: string;             // ISO 8601
}
```

### PersonalExpense (dépense personnelle)

```typescript
interface PersonalExpense {
  id: string;
  date: string;                  // YYYY-MM-DD
  merchant: string;              // Nom du marchand
  amount: number;
  receiptId?: string;            // Justificatif associé
  note?: string;
  createdAt: string;
}
```

### FilterStatus

```typescript
type FilterStatus = 'all' | 'pending' | 'matched' | 'auto-matched' | 'credit' | 'debit';
```

---

## Fonctionnalités Détaillées

### Import de relevés bancaires (PDF)

**Entrée** : Fichier PDF d'un relevé bancaire  
**Traitement** (`pdf-parser.ts`) :

1. **Extraction structurée** via `pdfjs-dist` : chaque élément textuel est positionné par coordonnées (x, y)
2. **Regroupement en lignes** : les éléments proches verticalement (tolérance ±3 unités) sont fusionnés
3. **Détection des colonnes** : recherche des en-têtes "Débit" / "Crédit" pour déterminer les positions X de référence
4. **Parsing des transactions** :
   - Détection de la date en début de ligne (`dd/mm/yy` ou `dd.mm.yyyy`)
   - Extraction des montants (format `1 234,56`)
   - Classification débit/crédit basée sur la position X du montant par rapport aux colonnes détectées
   - Extraction du libellé (texte entre la date et le premier montant)
5. **Filtrage** : exclusion des lignes de type "Total des opérations", "Nouveau solde", etc.

**Sortie** : Liste de `Transaction[]` avec `status: 'pending'` et `statementSource: filename`

### Import de justificatifs (OCR)

**Entrée** : Fichiers PDF ou images (JPG, PNG, WebP)  
**Pipeline** (`receipt-scanner.ts`) :

1. **Extraction de texte** :
   - **PDF** : réutilise `pdfjs-dist` (extraction native, pas d'OCR)
   - **Images** : OCR via Tesseract.js (français + anglais)
     - 1ère passe sur l'image originale
     - Si données insuffisantes : prétraitement (redimensionnement 1600-2400px, conversion niveaux de gris, augmentation du contraste ×1.45, binarisation)
     - 2ème passe sur l'image optimisée ; le meilleur résultat est retenu (scoring)

2. **Extraction des données** (`receipt-ocr-utils.ts`) :
   - **Montants** : scoring par mots-clés (`Total TTC`, `Net à payer`, `CB`, `Montant`) avec pondération (+14 pour "Total TTC", -6 pour "TVA/HT"). Formats européens supportés (`1 234,56`, `1.234,56`, `1234.56`)
   - **Date** : formats `dd/mm/yyyy`, `dd-mm-yy`, `YYYY-MM-DD`, mois en lettres françaises (`15 décembre 2025`). Score boosté si proche d'un mot-clé (`Date de facture`, `Ticket`)
   - **Marchand** : heuristique sur les 10 premières lignes — score basé sur : position haute, absence de chiffres, majuscules, longueur courte. Exclusion des lignes contenant SIRET, TVA, URL, etc.

3. **Score de qualité** : évalue la richesse du texte extrait (montants trouvés, date trouvée, mots-clés monétaires, nombre de lignes) pour comparer les résultats des deux passes OCR

**Progression** : 4 étapes avec callbacks (`extracting` → `recognizing` → `parsing` → `done`)

### Réconciliation automatique

**Algorithme** (`reconciliation.ts`) :

1. Filtrer les transactions `pending`
2. Pour chaque transaction, calculer un **score de correspondance** :
   - **+50 pts** si un montant OCR correspond exactement (±0,01 €)
   - **+0 à 30 pts** pour correspondance du libellé (mots communs entre nom de fichier et libellé bancaire, seuil > 30%)
3. Tri des candidats par score décroissant
4. Décision :
   - **Score ≥ 50** et meilleur candidat 1,5× supérieur au 2ème → `confidence: 'high'` → auto-rapprochement (`auto-matched`)
   - **Score ≥ 30** → `confidence: 'medium'` → suggestion à valider manuellement
   - Sinon → `confidence: 'none'` → création automatique d'une **dépense personnelle**

**Fallback filename** : si l'OCR ne détecte rien, les montants sont extraits du nom de fichier (ex: `facture_42,50.pdf`). Les noms génériques de caméra (`IMG_20260317_143355.jpg`) sont ignorés.

### Dépenses personnelles auto-créées

Quand un justificatif ne correspond à aucune transaction bancaire :
- Une `PersonalExpense` est automatiquement créée avec les données OCR (date, marchand, montant)
- Si le montant n'est pas détecté : `amount: 0` avec note "Montant non détecté — à compléter"
- Le justificatif est lié via `receiptId`
- Notification toast appropriée

### Validation sans justificatif

Pour les transactions sans pièce justificative applicable (prélèvements automatiques, frais bancaires) :
- L'utilisateur saisit un commentaire explicatif dans le `DetailPanel`
- La transaction passe en `status: 'matched'` avec `validationComment` renseigné
- Le justificatif éventuel est délié

### Réconciliation manuelle (dépense → transaction)

Depuis le tableau des dépenses personnelles :
- Bouton "Réconcilier" affiche la liste des transactions `pending`
- Sélection d'une transaction → le justificatif de la dépense est transféré à la transaction
- La transaction passe en `matched`
- La dépense personnelle est supprimée

### Export / Import

#### Export Excel (.xlsx)
3 onglets :
- **Transactions** : Date, Libellé, Débit, Crédit, Statut, Justificatif (nom fichier), Commentaire, Note, Relevé
- **Dépenses personnelles** : Date, Marchand, Montant, Justificatif, Note
- **Résumé** : Indicateurs clés (taux de réconciliation, totaux débits/crédits, solde net)

#### Export PDF (A4 paysage)
- En-tête avec statistiques globales
- Tableau des transactions avec colonne statut justificatif (✓/✗ colorés)
- Page dédiée aux dépenses personnelles si applicable

#### Import Excel
- Lecture des onglets "Transactions" et "Dépenses personnelles"
- Restauration des statuts, commentaires de validation, sources de relevé
- Parsing intelligent des montants (formats FR/EN)

---

## Interface Utilisateur

### Layout général

```
┌──────────────┬────────────────────────────────────┬──────────────┐
│              │              Header                │              │
│   Sidebar    ├────────────────────────────────────┤  DetailPanel │
│   (280px)    │                                    │   (400px)    │
│              │         Zone principale            │  (conditionnel)
│  - Filtres   │  - Dropzone justificatifs          │              │
│  - Résumé    │  - Sélecteurs mois/relevé          │              │
│  - Warning   │  - TransactionTable                │              │
│              │  - PersonalExpenseTable             │              │
└──────────────┴────────────────────────────────────┴──────────────┘
```

### États de l'interface

| État | Affichage |
|---|---|
| **Vide** | 2 dropzones centrées (relevé + justificatifs) + texte explicatif |
| **Avec données** | Dropzone compacte + sélecteurs + tableaux |
| **Processing** | Barre flottante "Analyse du relevé en cours..." |
| **OCR en cours** | Barre de progression avec étapes (Extraction → OCR → Analyse → Terminé) |

### Sidebar (280px, fixe)

- **Logo** : "Ledge" + sous-titre "Réconciliation locale"
- **Filtres par statut** : Tout / En attente / Réconcilié / Auto-rapproché
- **Filtres par type** : Crédits / Débits
- **Résumé** (si données présentes) :
  - En attente (count)
  - Crédits (montant total, vert)
  - Débits (montant total, rouge)
  - Justificatifs (count total importés)
  - Taux de réconciliation (%)
  - Dépenses personnelles non réconciliées (count, orange)
- **Avertissement** : "Données stockées localement. Vider le cache efface les données."

### Header

- Statut textuel ("X transaction(s) en attente de justificatif" / "Toutes justifiées ✓" / "Aucune donnée")
- **Boutons** : Export Excel / Export PDF / Import Excel / Dépense personnelle / Importer relevé / Tout effacer

### Tableau des transactions

| Colonne | Largeur | Contenu |
|---|---|---|
| Indicateur | 3px | Barre colorée selon statut |
| Date | 100px | Format mono |
| Type | 50px | CR ↓ (vert) / DB ↑ (rouge) |
| Libellé | flex | Texte + note réconciliation + commentaire validation |
| Montant | 120px | Mono, aligné droite, coloré |
| Justificatif | 180px | Nom fichier avec icône ✓/✗ |
| État | 130px | Badge coloré |
| Actions | 80px | Délier / Supprimer (visible au hover) |

### Tableau des dépenses personnelles

| Colonne | Contenu |
|---|---|
| Indicateur | Barre orange |
| Date | Éditable inline |
| Marchand | Éditable inline |
| Montant | Éditable inline |
| Justificatif | Nom du fichier associé |
| Note | Éditable inline |
| État | Badge "À rembourser" |
| Actions | Modifier / Réconcilier / Supprimer |

### DetailPanel (panneau latéral droit, 400px)

- Slide-in depuis la droite (framer-motion)
- Affiche : Date, Libellé, Montant, Ligne brute
- Si justificatif lié : aperçu image ou nom fichier PDF
- Si pas de justificatif :
  - Dropzone pour upload direct
  - Liste des justificatifs non liés disponibles
  - Zone "Valider sans justificatif" avec textarea + bouton

### PersonalExpensePanel (panneau latéral droit, 400px)

- Workflow en 2 étapes : import justificatif (OCR) → formulaire pré-rempli
- Affichage des résultats OCR détectés
- Sélection parmi les montants alternatifs détectés
- Option "Saisir manuellement sans justificatif"

---

## Design System

### Palette de couleurs (HSL)

| Token | Valeur | Usage |
|---|---|---|
| `--primary` | `142 70% 45%` | Vert — crédits, succès, rapprochement |
| `--destructive` | `0 84.2% 60.2%` | Rouge — débits, erreurs, suppression |
| `--personal` | `25 95% 53%` | Orange — dépenses personnelles |
| `--match` | `142 70% 45%` | Vert match |
| `--match-light` | `142 76% 96%` | Fond vert clair |
| `--pending` | `240 5.9% 85%` | Gris — en attente |
| `--personal-light` | `33 100% 96%` | Fond orange clair |
| `--accent` | `240 5.9% 10%` | Noir — boutons primaires |
| `--background` | `0 0% 100%` | Blanc |
| `--foreground` | `240 10% 3.9%` | Quasi-noir |

### Typographie

- **Corps** : Geist, 13px (`0.8125rem`), letter-spacing -0.02em
- **Mono** : Geist Mono (tabular-nums) pour montants, dates, codes
- **Labels** : 10px uppercase, tracking widest, `text-muted-foreground`

### Animations

- `transition-snappy` : 150ms cubic-bezier(0.16, 1, 0.3, 1)
- `animate-match-flash` : fond vert clair → transparent sur 1s
- Panneaux latéraux : slide-in/out 300ms
- Lignes de tableau : fade-in avec décalage progressif (20ms/ligne)

---

## Flux Utilisateur Principaux

### Première utilisation
```
1. Page vide → 2 dropzones
2. Drag & drop relevé PDF → extraction → transactions affichées
3. Drag & drop justificatifs → OCR → réconciliation auto
4. Transactions passent de "En attente" à "Auto-rapproché"
5. Justificatifs non matchés → dépenses personnelles auto-créées
```

### Réconciliation manuelle
```
1. Clic sur transaction "En attente" → DetailPanel
2. Upload justificatif OU sélection parmi les disponibles OU validation sans justificatif
3. Transaction passe en "Justifié"
```

### Réconciliation via dépense personnelle
```
1. Dépense personnelle → clic icône Link
2. Liste des transactions pending affichée
3. Sélection → justificatif transféré, dépense supprimée
```

### Export
```
1. Clic Excel/PDF → téléchargement immédiat
2. Import Excel → restauration des transactions + dépenses
```

---

## Statistiques Calculées

| Indicateur | Calcul |
|---|---|
| `total` | Nombre de transactions (filtrées par mois/relevé) |
| `pending` | Transactions avec `status === 'pending'` |
| `matched` | Transactions `matched` + `auto-matched` |
| `autoMatched` | Transactions `auto-matched` uniquement |
| `credit` / `debit` | Compteurs par type |
| `creditAmount` / `debitAmount` | Sommes par type |
| `totalReceipts` | Nombre total de justificatifs importés |
| `unmatchedReceipts` | Justificatifs sans `linkedTransactionId` |
| `personal` | Nombre de dépenses personnelles |

---

## Filtrage et Navigation

### Filtres combinés (pipeline)
```
Transactions brutes
  → Filtre par relevé source (StatementSelector)
  → Filtre par mois (MonthSelector)
  → Filtre par statut/type (SidebarFilter)
  = Transactions affichées
```

### Mois disponibles
Extraits dynamiquement des dates des transactions (formats `dd/mm/yy` et `YYYY-MM-DD`), triés chronologiquement.

### Relevés sources
Extraits des `statementSource` uniques des transactions, triés alphabétiquement.

---

## Gestion des Erreurs

| Cas | Comportement |
|---|---|
| Fichier non-PDF importé comme relevé | Toast erreur "n'est pas un fichier PDF" |
| PDF sans transactions détectées | Toast warning "Aucune transaction trouvée" |
| OCR échoué | Log console, progression reset, fallback nom de fichier |
| Montant non détecté (justificatif) | Dépense créée avec `amount: 0` + note explicative |
| Import Excel invalide | Toast erreur "Erreur lors de l'import Excel" |
| localStorage plein / corrompu | Fallback tableau vide (`catch { return [] }`) |

---

## Limites et Contraintes

1. **Pas de backend** : toutes les données sont locales, pas de synchronisation multi-appareils
2. **Fichiers non persistés** : les blobs (images, PDF) sont perdus au rechargement — seules les métadonnées survivent
3. **OCR côté client** : performance limitée par le CPU du navigateur, temps de traitement variable (5-30s par image)
4. **Format de relevé** : optimisé pour les relevés bancaires français avec colonnes Débit/Crédit structurées
5. **Pas de dark mode** : seul le thème clair est configuré
6. **Pas d'authentification** : application mono-utilisateur locale

---

## Tests

| Fichier | Couverture |
|---|---|
| `src/test/receipt-ocr-utils.test.ts` | Extraction montants (facture Leclerc), dates avec bruit OCR, filtre noms caméra, parsing noms structurés |
| `src/test/example.test.ts` | Test de base |
| `playwright.config.ts` | Configuration E2E (non implémenté) |

---

## Développement Local

```sh
# Cloner le dépôt
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Installer les dépendances
npm i

# Lancer le serveur de développement
npm run dev
```

### Technologies
- Vite + React + TypeScript
- shadcn/ui + Tailwind CSS
- Déploiement : Lovable → Share → Publish
