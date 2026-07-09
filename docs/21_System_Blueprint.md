# 21_System_Blueprint.md

# Recall AI App --- System Blueprint

## High-Level Vision

Recall is composed of independent modules connected through a shared
data model and an Evidence Engine.

``` text
             Browser Extension
                    |
        Manual Paste / CSV / APIs
                    |
              Capture Layer
                    |
          Raw Capture Repository
                    |
          Normalization Services
                    |
            AI Extraction Engine
                    |
      ------------------------------
      |      |      |      |      |
    Tasks  People Projects Finance Knowledge
      \      |      /        |      /
        ------- Evidence Engine -------
                    |
             Query & Reasoning
                    |
               User Interface
```

## Core Layers

### Capture Layer

Receives all incoming information from browser extensions, connectors,
manual paste, uploads, and APIs.

### Raw Repository

Stores original information permanently for traceability.

### Normalization Layer

Converts external formats into Recall's internal model.

### AI Extraction Layer

Extracts tasks, people, projects, dates, priorities, summaries, and
relationships.

### Evidence Engine

Every derived object references its original source. This is the trust
layer of Recall.

### Query Engine

Answers natural-language questions using structured data plus evidence.

### UI Modules

-   Today
-   Inbox
-   Tasks
-   People
-   Projects
-   Knowledge
-   Finance
-   Documents
-   Family
-   Connectors

All are different views of the same underlying data.

## Guiding Principles

1.  Capture once.
2.  Use everywhere.
3.  Preserve evidence.
4.  Respect source-of-truth systems.
5.  Make AI explainable.
6.  Design for modular growth.

## Future Evolution

New capabilities should be added as connectors or modules, not isolated
applications. Every new feature should integrate into the existing
architecture instead of creating a new silo.
