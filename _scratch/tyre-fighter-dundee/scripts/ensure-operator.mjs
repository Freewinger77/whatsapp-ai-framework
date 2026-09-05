const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = process.env.DUNDEE_OPERATOR_EMAIL;
const password = process.env.DUNDEE_OPERATOR_PASSWORD;

if (!supabaseUrl || !secret || !email || !password) {
  console.error("need SUPABASE_URL, SUPABASE_SECRET_KEY, DUNDEE_OPERATOR_EMAIL, DUNDEE_OPERATOR_PASSWORD");
  process.exit(1);
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};

const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "dundee_operator" },
  }),
});

if (created.ok) {
  const body = await created.json();
  console.log("created operator", body.id, email);
  process.exit(0);
}

const text = await created.text();
if (!text.includes("already") && created.status !== 422) {
  console.error("create failed", created.status, text);
  process.exit(1);
}

const listed = await fetch(
  `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`,
  { headers }
);
if (!listed.ok) {
  console.error("list users failed", listed.status, await listed.text());
  process.exit(1);
}
const data = await listed.json();
const users = data.users || data;
const existing = users.find((user) => user.email === email);
if (!existing) {
  console.error("user exists but could not be found", text);
  process.exit(1);
}

const updated = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ password, email_confirm: true }),
});
if (!updated.ok) {
  console.error("update failed", updated.status, await updated.text());
  process.exit(1);
}
console.log("updated operator password", existing.id, email);
