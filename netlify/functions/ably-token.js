import Ably from 'ably';

export default async (request, context) => {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing ABLY_API_KEY in Netlify environment variables.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const clientId = new URL(request.url).searchParams.get('clientId') || 'overlay-client';
    const rest = new Ably.Rest(apiKey);
    const tokenRequest = await rest.auth.createTokenRequest({ clientId });

    return new Response(JSON.stringify(tokenRequest), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Unable to create Ably token request.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
