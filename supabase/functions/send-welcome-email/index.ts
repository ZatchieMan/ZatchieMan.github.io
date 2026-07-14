// Sends a welcome email via Resend when a new user signs up.
// Triggered by a Postgres trigger on auth.users (see migration 0005), not by
// the client — deployed with --no-verify-jwt since the caller is our own
// database, not an end user, and no sensitive data is read or returned here.

import { Resend } from "npm:resend@4";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const resend = new Resend(RESEND_API_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const html = `
<div style="background:#16181c;padding:32px 20px;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#1f2329;border-radius:12px;padding:32px;border:1px solid #333b44;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
      <span style="display:inline-block;width:4px;height:20px;background:#f5b301;border-radius:2px;"></span>
      <span style="font-family:Arial,sans-serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#e8e6e1;font-size:20px;">Iron Log</span>
    </div>
    <h1 style="color:#e8e6e1;font-size:22px;margin:0 0 12px;">Welcome to Iron Log 💪</h1>
    <p style="color:#c7c9cc;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Thanks for signing up. Iron Log is a no-nonsense strength training tracker — log every set, run real programs, and watch your numbers climb.
    </p>
    <p style="color:#c7c9cc;font-size:15px;line-height:1.6;margin:0 0 16px;">
      A few things worth trying first:
    </p>
    <ul style="color:#c7c9cc;font-size:15px;line-height:1.8;margin:0 0 20px;padding-left:20px;">
      <li>Build a training program with real weekdays and a calendar</li>
      <li>Turn on workout reminders in Profile → Settings</li>
      <li>Log your first workout and start climbing the level ranks</li>
    </ul>
    <p style="color:#8a929c;font-size:13px;line-height:1.6;margin-top:28px;border-top:1px solid #333b44;padding-top:16px;">
      Questions or feedback? Just use the Feedback button in Settings — it comes straight to us.
    </p>
  </div>
</div>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "missing email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await resend.emails.send({
      from: "Iron Log <onboarding@resend.dev>",
      to: email,
      subject: "Welcome to Iron Log 💪",
      html,
    });

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("welcome email failed", e?.message);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
