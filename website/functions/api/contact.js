/**
 * Optional Cloudflare Pages Function (API Route)
 * Endpoint: POST /api/contact
 * Handles JSON support submissions if connected to a webhook / MailChannels / Resend.
 */

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { name, email, category, subject, message, env } = data;

    const formattedPayload = {
      to: "support@jeddah.dev",
      product: "HotSwap for Claude (v1.0.0)",
      category: category || "General Inquiry",
      subject: `[HotSwap for Claude] [${category || "Inquiry"}] ${subject || "Support Ticket"}`,
      senderName: name || "Anonymous",
      senderEmail: email || "unknown@domain.com",
      clientEnvironment: env || "Unknown",
      message: message || "",
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Ticket received by Cloudflare endpoint.",
      payload: formattedPayload 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: err.message 
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}
