# SRS v3 and system analysis — Nguyễn Quốc Hiền

## Latest handoff for review

The SRS v3.1 updated on 2026-09-24 consolidates Hiền's v0.5 analysis, Hoàng's review draft,
and the repository scope decisions. Review the following files together:

- [SRS v3](srs-v3.md): latest consolidated review source, with 37 legacy FR
  aliases, 13 use cases and 60 proposed test cases.
- [SRS v3 Word](srs-v3.docx): matching formatted handoff, visually checked
  across all 32 rendered pages, with an updated table of contents.
- [Review notes](srs-v3-review-notes.md): source comparison and changes.

Section 15 records D01–D10 as confirmed by Hoàng on 2026-09-23 and the
Search limits in D04/D09 as confirmed by Đạt on 2026-09-24. The test cases
remain NOT_RUN specifications. This handoff does not alter the Search contract,
runtime code or database schema.

The v0.5 files below are retained for history. The XMI/VPP models retain their
existing high-level topology. D01–D10 refine existing actors and flows without
adding a new top-level actor or system use case, so no diagram topology change
is required; UC-HT11–13 remain detailed flows in SRS v3.1.

## Previous analysis

This folder contains the phase-1 system-analysis deliverables derived from
`SRS_DeTai18_v2` and normalized against the repository integration decisions.

## Files

- `system-analysis-v0.5.md`: previous review copy kept in Git for traceability.
- `system-analysis-v0.5.docx`: local formatted export for the thesis team; the
  repository keeps the Markdown copy as the review source.
- `use-cases.xmi`: exchange model for UML tools.
- `use-cases.vpp`: Visual Paradigm project imported from the XMI model.

Office binaries are ignored by default. Only `srs-v3.docx` has a narrow
exception for this explicitly requested team handoff. The older v0.5 DOCX is
a local export and is not the latest SRS.

## Review ownership

### Võ Minh Hoàng

- Review the ERD, relationships, ownership and authorization rules.
- Review cart/checkout behavior, inventory updates and order transitions embedded
  in `UC-HT04` and `UC-HT07`.
- Review the proposed Backend and Admin APIs.

### Nguyễn Cao Dũng Đạt

- Review the integer `productId` contract and ABO `externalId` mapping.
- Review the FastAPI Search Service flow for Elasticsearch, CLIP/FAISS and RRF.
- Review Search Service request/response schemas, indexing responsibilities, filters, top K,
  timeout behavior and evaluation metrics.

## Source precedence used

`SRS_DeTai18_v2` defines the required scope, modules and technology direction.
Newer repository decisions define integration details: PostgreSQL-generated
integer `productId`, nullable namespaced import-only `externalId`, the multi-category
Product domain, Chat MVP, and the current 1,200-item ABO electronics prototype corpus.
FastAPI owns Elasticsearch, CLIP/FAISS and RRF; NestJS keeps PostgreSQL as the source
of truth. COD is the P0 baseline. VNPay/MoMo sandbox is a P1 commitment after the
Order, COD and Payment model are stable; production payment, online refund, Seller
wallets and real settlement/withdrawal remain P2.

Develop was synchronized again on 2026-09-18 after PR #10, #12 and #15 merged.
The ERD marks current Product/Store schema separately from target P0/P1 extensions.
Current Store/Category/Brand behavior follows PR #15; buyer-to-seller onboarding and
basic returns/refunds remain targets requiring later migrations and APIs. The Search
contract is owned by PR #8 (Hoàng confirmed `8f2b058`); PR #5 leaves that file
identical to develop. Search remains IN_PROGRESS/TARGET.

On 2026-09-19, PR #16's full CI workflow was merged into this branch. The review
copy now specifies cross-request refund limits/locking, revenue projection only
after COMPLETED, and CURRENT/TARGET buyer/seller capabilities. XMI/VPP retain
the existing high-level use-case topology; detailed constraints are in Markdown.
