/**
 * DondeAI Weekly CEO Digest
 *
 * Sends a weekly email summary to the CEO with:
 * - Avg DondeMatch trend (this week vs last week)
 * - Total production queries
 * - Low-score query count
 * - Test run summary (pass rate, gap count)
 * - Top issues needing attention
 *
 * Trigger: Supabase cron (pg_cron) every Monday 8am CT
 * Or: GET /weekly-digest?key=<service_key> for manual trigger
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = Deno.env.get("SUPAB_URL");
  const serviceKey = Deno.env.get("SUPAB_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const ceoEmail = Deno.env.get("CEO_EMAIL") || "aacrit@gmail.com";

  if (!url || !serviceKey) {
    return jsonResp({ error: "Missing env vars" }, 500);
  }

  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

    // Parallel data fetches
    const [thisWeekQueries, lastWeekQueries, recentRuns, recentGaps] = await Promise.all([
      // This week's production queries
      sb.from("user_queries")
        .select("id, donde_match, created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false }),

      // Last week's production queries (for comparison)
      sb.from("user_queries")
        .select("id, donde_match, created_at")
        .gte("created_at", twoWeeksAgo.toISOString())
        .lt("created_at", weekAgo.toISOString()),

      // This week's test runs
      sb.from("gauntlet_runs")
        .select("run_id, avg_dm, passed_60, gap_count, total, created_at, mode")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false }),

      // This week's gaps (failed queries from test runs)
      sb.from("gauntlet_results")
        .select("query, donde_match, gap_type, restaurant_name, run_id")
        .not("gap_type", "is", null)
        .gte("created_at", weekAgo.toISOString())
        .order("donde_match", { ascending: true })
        .limit(10),
    ]);

    const twQ = thisWeekQueries.data || [];
    const lwQ = lastWeekQueries.data || [];
    const runs = recentRuns.data || [];
    const gaps = recentGaps.data || [];

    // Compute metrics
    const twCount = twQ.length;
    const lwCount = lwQ.length;
    const twAvgDm = twCount > 0 ? twQ.reduce((s, q) => s + (q.donde_match || 0), 0) / twCount : 0;
    const lwAvgDm = lwCount > 0 ? lwQ.reduce((s, q) => s + (q.donde_match || 0), 0) / lwCount : 0;
    const dmDelta = twAvgDm - lwAvgDm;
    const twLowScores = twQ.filter(q => (q.donde_match || 0) < 60).length;
    const lwLowScores = lwQ.filter(q => (q.donde_match || 0) < 60).length;

    // Test run stats
    const totalTestQueries = runs.reduce((s, r) => s + (r.total || 0), 0);
    const avgPassRate = runs.length > 0
      ? runs.reduce((s, r) => s + (r.total > 0 ? r.passed_60 / r.total * 100 : 0), 0) / runs.length
      : 0;
    const totalGaps = runs.reduce((s, r) => s + (r.gap_count || 0), 0);

    // Build digest
    const digest = {
      period: `${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      production: {
        searches: twCount,
        searches_delta: twCount - lwCount,
        avg_dm: Math.round(twAvgDm * 10) / 10,
        avg_dm_delta: Math.round(dmDelta * 10) / 10,
        low_scores: twLowScores,
        low_scores_delta: twLowScores - lwLowScores,
      },
      testing: {
        runs: runs.length,
        queries_tested: totalTestQueries,
        avg_pass_rate: Math.round(avgPassRate * 10) / 10,
        total_gaps: totalGaps,
      },
      top_issues: gaps.slice(0, 5).map(g => ({
        query: g.query,
        dm: g.donde_match,
        gap_type: g.gap_type,
        restaurant: g.restaurant_name,
      })),
    };

    // Build HTML email
    const emailHtml = buildEmailHtml(digest);

    // Send via Resend if API key available
    let emailSent = false;
    if (resendKey) {
      try {
        const emailResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "DondeAI <digest@dondeai.com>",
            to: [ceoEmail],
            subject: `DondeAI Weekly: DM ${Math.round(twAvgDm)} ${dmDelta >= 0 ? "↑" : "↓"}${Math.abs(Math.round(dmDelta))} | ${twCount} searches`,
            html: emailHtml,
          }),
        });
        emailSent = emailResp.ok;
      } catch (e) {
        console.warn("Email send failed:", e);
      }
    }

    return jsonResp({
      success: true,
      email_sent: emailSent,
      digest,
    });
  } catch (e) {
    console.error("Digest generation failed:", e);
    return jsonResp({ error: "Digest generation failed", details: String(e) }, 500);
  }
});

function buildEmailHtml(d: any): string {
  const arrow = (v: number) => v > 0 ? `<span style="color:#22c55e">↑${v}</span>` : v < 0 ? `<span style="color:#ef4444">↓${Math.abs(v)}</span>` : `<span style="color:#888">→0</span>`;
  const ragColor = (dm: number) => dm >= 80 ? "#22c55e" : dm >= 60 ? "#f59e0b" : "#ef4444";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0d0f;color:#e4e4e7;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto">
    <h1 style="font-size:20px;margin-bottom:4px;color:#fff">DondeAI Weekly Digest</h1>
    <p style="color:#71717a;font-size:13px;margin-top:0">${d.period}</p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <tr>
        <td style="background:#16181c;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;width:33%">
          <div style="font-size:28px;font-weight:700;color:${ragColor(d.production.avg_dm)}">${d.production.avg_dm}</div>
          <div style="font-size:12px;color:#a1a1aa">Avg DondeMatch ${arrow(d.production.avg_dm_delta)}</div>
        </td>
        <td style="width:8px"></td>
        <td style="background:#16181c;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;width:33%">
          <div style="font-size:28px;font-weight:700;color:#fff">${d.production.searches}</div>
          <div style="font-size:12px;color:#a1a1aa">Searches ${arrow(d.production.searches_delta)}</div>
        </td>
        <td style="width:8px"></td>
        <td style="background:#16181c;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;width:33%">
          <div style="font-size:28px;font-weight:700;color:${d.production.low_scores > 5 ? '#ef4444' : d.production.low_scores > 0 ? '#f59e0b' : '#22c55e'}">${d.production.low_scores}</div>
          <div style="font-size:12px;color:#a1a1aa">Low Scores ${arrow(-d.production.low_scores_delta)}</div>
        </td>
      </tr>
    </table>

    ${d.testing.runs > 0 ? `
    <h2 style="font-size:15px;color:#a1a1aa;margin-bottom:8px">Testing</h2>
    <p style="font-size:14px;margin:0">${d.testing.runs} test runs, ${d.testing.queries_tested} queries. <strong>${d.testing.avg_pass_rate}%</strong> avg pass rate. <strong style="color:${d.testing.total_gaps > 5 ? '#ef4444' : '#f59e0b'}">${d.testing.total_gaps}</strong> gaps found.</p>
    ` : '<p style="font-size:14px;color:#71717a">No test runs this week.</p>'}

    ${d.top_issues.length > 0 ? `
    <h2 style="font-size:15px;color:#a1a1aa;margin:16px 0 8px">Top Issues</h2>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      ${d.top_issues.map((g: any) => `
        <tr style="border-bottom:1px solid #27272a">
          <td style="padding:6px 0;color:${ragColor(g.dm)};font-weight:600;font-family:monospace">DM ${g.dm}</td>
          <td style="padding:6px 8px;color:#e4e4e7">"${g.query}"</td>
          <td style="padding:6px 0;color:#ef4444;font-size:11px;text-transform:uppercase">${g.gap_type}</td>
        </tr>
      `).join("")}
    </table>
    ` : ''}

    <p style="text-align:center;margin-top:24px">
      <a href="https://dondeai.com/command-center.html" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Command Center</a>
    </p>

    <p style="font-size:11px;color:#52525b;text-align:center;margin-top:16px">DondeAI • Chicago</p>
  </div>
</body>
</html>`;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
