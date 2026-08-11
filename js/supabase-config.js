/* Public Supabase configuration.
 *
 * The publishable key below is designed to be shipped in browser code: it grants only
 * the `anon` role, which this project's RLS policies give no access to. It is NOT a
 * secret.
 *
 * Never place the service role key, the Resend API key, or any Supabase secret in this
 * file or anywhere else the browser can read.
 */
window.SUPABASE_CONFIG = Object.freeze({
  url: "https://ynhjbeuwfbdsrmzbpeiy.supabase.co",
  publishableKey: "sb_publishable_OxIVlY18fSBhjmaXT-HnZw_pB6mE-2r",
  functionsUrl: "https://ynhjbeuwfbdsrmzbpeiy.supabase.co/functions/v1",
});
