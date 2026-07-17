// Runs on a schedule (Supabase Cron, every 15 min). For every user who has
// either reminder type enabled, checks whether "now" (in their timezone) is
// due for that reminder, and if so sends a Web Push notification to each of
// their subscribed devices.
//   - Workout reminder: fires ~1 hour before their analyzed "usual workout time".
//   - Weight-log reminder: fires at their chosen daily time, but only if
//     today's weight hasn't already been logged.
//
// Required secrets (set via `supabase secrets set` or the dashboard):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a "mailto:you@example.com")
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the platform.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nowPartsInTz(tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  const hour = parts.hour === "24" ? 0 : parseInt(parts.hour, 10);
  return {
    minutesOfDay: hour * 60 + parseInt(parts.minute, 10),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_INDEX[parts.weekday],
  };
}

function isDue(nowMin: number, targetMin: number) {
  const diff = ((nowMin - targetMin) % 1440 + 1440) % 1440;
  return diff < 15;
}

type Sub = { endpoint: string; p256dh: string; auth: string; last_notified_date: string | null; last_weight_notified_date: string | null };

async function sendToSubs(
  supabase: any,
  userId: string,
  subs: Sub[],
  dedupField: "last_notified_date" | "last_weight_notified_date",
  today: string,
  body: string,
) {
  let sent = 0;
  for (const sub of subs) {
    if (sub[dedupField] === today) continue; // already notified today for this reminder type
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    const payload = JSON.stringify({ title: "Iron Log", body });
    try {
      await webpush.sendNotification(pushSub, payload);
      await supabase.from("push_subscriptions")
        .update({ [dedupField]: today })
        .eq("user_id", userId).eq("endpoint", sub.endpoint);
      sent++;
    } catch (e: any) {
      const status = e?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
      } else {
        console.error("push failed", userId, status, e?.message);
      }
    }
  }
  return sent;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: rows, error } = await supabase
    .from("user_data")
    .select("user_id, data")
    .or("data->profile->reminder->>enabled.eq.true,data->profile->weightReminder->>enabled.eq.true");

  if (error) {
    console.error("query failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0, due = 0, skipped = 0;

  for (const row of rows || []) {
    const profile = row.data?.profile || {};
    const workout = profile.reminder;
    const weight = profile.weightReminder;

    const activeWeekdays: number[] = Array.isArray(workout?.weekdays) ? workout.weekdays : [0, 1, 2, 3, 4, 5, 6];
    const workoutDue = !!workout?.enabled && workout.usualHour != null && workout.usualMinute != null && workout.timezone
      ? (() => {
          const tzNow = nowPartsInTz(workout.timezone);
          return activeWeekdays.includes(tzNow.weekday)
            && isDue(tzNow.minutesOfDay, (((workout.usualHour * 60 + workout.usualMinute) - 60) % 1440 + 1440) % 1440);
        })()
      : false;

    let weightDue = false;
    if (weight?.enabled && weight.hour != null && weight.minute != null && weight.timezone) {
      const { minutesOfDay } = nowPartsInTz(weight.timezone);
      // weightLog dates are stored as the client's UTC calendar date (todayISO()), not local — match that here.
      const utcToday = new Date().toISOString().slice(0, 10);
      const alreadyLogged = (profile.weightLog || []).some((e: any) => e.date === utcToday);
      weightDue = !alreadyLogged && isDue(minutesOfDay, weight.hour * 60 + weight.minute);
    }

    if (!workoutDue && !weightDue) { skipped++; continue; }
    due++;

    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, last_notified_date, last_weight_notified_date")
      .eq("user_id", row.user_id);
    if (subErr || !subs || !subs.length) continue;

    if (workoutDue) {
      const today = nowPartsInTz(workout.timezone).dateStr;
      sent += await sendToSubs(supabase, row.user_id, subs as Sub[], "last_notified_date", today,
        "Your usual workout time is in about an hour — time to get ready.");
    }
    if (weightDue) {
      const today = nowPartsInTz(weight.timezone).dateStr;
      sent += await sendToSubs(supabase, row.user_id, subs as Sub[], "last_weight_notified_date", today,
        "Don't forget to log today's weight.");
    }
  }

  return new Response(JSON.stringify({ checked: rows?.length || 0, due, sent, skipped }), {
    headers: { "Content-Type": "application/json" },
  });
});
