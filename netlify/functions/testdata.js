// /api/testdata
// POST → testopslag wissen en opnieuw kopiëren uit de echte opslag (enkel testmodus)

import { getStore } from '@netlify/blobs';
import { isTestVerzoek, wisTestopslag, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';

const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Blitz-Test',
    'Vary': 'Origin',
  };
}

const kern = async (req, context, gebruiker) => {
  const hdrs = { ...corsHeaders(req), 'Content-Type': 'application/json' };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: hdrs });
  }
  if (!isTestVerzoek(req)) {
    return new Response(JSON.stringify({ error: 'Enkel in testmodus' }), { status: 403, headers: hdrs });
  }

  try {
    await wisTestopslag(getStore);
    const gekopieerd = await zorgVoorTestkopie(getStore, { gooiFout: true });
    return new Response(JSON.stringify({ ok: true, gekopieerd }), { status: 200, headers: hdrs });
  } catch (err) {
    console.error('[testdata]', err?.message || err);
    return new Response(JSON.stringify({ error: 'Kopiëren mislukt' }), { status: 500, headers: hdrs });
  }
};

export default beveiligV2('testdata', kern);

export const config = { path: '/api/testdata' };
