/* Admin sign-in. Authentication is performed by Supabase Auth — this file never
 * compares passwords, never stores credentials, and never decides authorization itself.
 * Authorization is confirmed by reading admin_users, which RLS exposes only to admins. */
import { supabase, notice } from "./core.js";

const form = document.querySelector("[data-login-form]");
const submit = form.querySelector('button[type="submit"]');

const params = new URLSearchParams(location.search);
if (params.has("denied")) {
  notice("That account is not authorized to use the admin dashboard.", "error");
} else if (params.has("expired")) {
  notice("Your session has expired. Please sign in again.", "info");
}

// Already signed in and authorized? Skip the form.
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data } = await supabase
    .from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle();
  if (data) location.replace("index.html");
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;

  const email = form.querySelector('[name="email"]').value.trim().toLowerCase();
  const password = form.querySelector('[name="password"]').value;

  if (!email || !password) {
    notice("Enter your email and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  notice("");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    notice("Incorrect email or password.", "error");
    submit.disabled = false;
    submit.textContent = "Sign In";
    return;
  }

  // Authenticated — now check authorization.
  const { data: admin } = await supabase
    .from("admin_users").select("user_id").eq("user_id", data.session.user.id).maybeSingle();

  if (!admin) {
    await supabase.auth.signOut();
    notice("That account is not authorized to use the admin dashboard.", "error");
    submit.disabled = false;
    submit.textContent = "Sign In";
    return;
  }

  location.replace("index.html");
});
