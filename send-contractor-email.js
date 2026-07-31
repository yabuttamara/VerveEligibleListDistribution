// Netlify Function: send-contractor-email
// Sends an email with an xlsx attachment via the Resend API
// Environment variable required: RESEND_API_KEY

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
  }

  // Default sender — update this to your verified Resend domain
  const FROM_EMAIL = process.env.FROM_EMAIL || 'Verve Portraits <noreply@verveportraits.com.au>';

  try {
    const { to, subject, html, attachment, filename } = JSON.parse(event.body);

    if (!to || !subject || !attachment || !filename) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: to, subject, attachment, filename' }) };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: subject,
        html: html || '<p>Please find your session summary attached.</p>',
        attachments: [
          {
            filename: filename,
            content: attachment,  // base64-encoded
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.message || 'Resend API error' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: data.id }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
