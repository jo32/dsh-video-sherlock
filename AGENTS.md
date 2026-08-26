# DeepDeck App development

- Extend this App through Cordis services, slots, stores, and lifecycle effects.
- Keep Host code in src/index.js and Client UI in src/client.js.
- Do not patch the Harness DOM, inject global CSS, or use Electron APIs from Client code.
- Keep package identity, dsh.app identity, exports, invariant, and cordis.patch.yml aligned.
- Generated lib/ output is build-only and must not be committed.
- Before finishing source edits, call deepdeck_app_apply when it is available. It performs the authoritative build and runtime apply; do not run a duplicate build first.
