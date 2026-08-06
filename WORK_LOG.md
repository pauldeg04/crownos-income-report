# CrownOS Work Log

Running log of changes made to the CrownOS system, newest entry on top.

---

## 2026-08-06 — Cashflow branch-mixing bug (Calamba/Biñan)

**Reported by:** User — "hindi pala magkabukod ang records ng cashflow sa calamba at sa binan" /
"kapag nagswitch ako between branches, hindi nagbabago."

**Root cause found:**
- [`cashflow.js`](cashflow.js) only loaded branch data once, on page load. Switching branches
  from the global toolbar while already on the Cash Flow page did not refresh the on-screen
  data or the in-memory entry list.
- If an entry was then added/edited/deleted in that stale state, the save function correctly
  computed the *new* branch's storage key, but wrote the *old* branch's entries into it —
  silently overwriting the other branch's real cashflow data.
- Confirmed on the live app: `crownCashflow_Biñan_2026-08` and `crownCashflow_Calamba_2026-08`
  held byte-identical data (same entry IDs), proving Calamba's real August entries had been
  overwritten by a copy of Biñan's.
- Separately found `migrateBranchReferences()` in [`list-branches.js`](list-branches.js) was
  missing the `crownCashflow_` prefix, so renaming a branch (e.g. "Crown Head Spa Biñan" →
  "Biñan") left old cashflow records orphaned under the old name instead of moving them —
  confirmed orphaned `crownCashflow_Crown Head Spa Biñan_2026-07` /
  `..._Crown Head Spa Calamba_2026-07` keys still in storage.

**Fix applied:**
1. `cashflow.js` — added a `crownGlobalFiltersChanged` listener that re-reads the selected
   branch and reloads entries whenever the toolbar branch switcher changes, without needing a
   full page reload.
2. `list-branches.js` — added `crownCashflow_` to the prefix list in `migrateBranchReferences()`
   so future branch renames carry cashflow history along correctly.

**Deployed:** `firebase deploy --only hosting` → live at https://crownos-5f03d.web.app

**Data cleanup:** Cleared `crownCashflow_Calamba_2026-08` (was a duplicate of Biñan's data, per
user's instruction to treat the merged entries as Biñan's). Biñan's August data (8 entries,
₱17,271.50) verified intact. **Calamba's real August 2026 cashflow entries were not recoverable
and need to be manually re-entered by the user.**

**Not affected (verified):** July 2026 cashflow, and Expenses/Daily Sales records for both
branches — data was distinct per branch, no duplication found.
