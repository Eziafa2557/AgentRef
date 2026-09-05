/**
 * Ambient declarations for the OPTIONAL genlayer-js SDK.
 *
 * genlayer-js is intentionally NOT a dependency: the app must build and run
 * without it (SIMULATED adjudicator path). The adapter reaches it via dynamic
 * import at runtime only, so these declarations keep tsc happy while the SDK is
 * absent. Install genlayer-js when you want the real on-chain path; its own
 * types then supersede these.
 */
declare module "genlayer-js";
declare module "genlayer-js/chains";
