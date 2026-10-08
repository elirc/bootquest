# Planted practice (NOT estate content)

Synthetic stand-in for the andie repo (tests copy this tree to a temp dir and add
`astraupskill/VERIFICATION.md` with a planted, fake token pattern at runtime).

## Senior findings in the delivered code

1. **Store credentials are pasted into the verification log.** The run notes in `astraupskill/VERIFICATION.md:3` carry an API token verbatim, so anyone with read access to the repo can call the store.
2. **Checkout totals are recomputed in the browser.** `src/cart.js:2` sums prices client-side and the server trusts the submitted total.
