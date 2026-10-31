import { createAuthClient, type VanillaBetterAuthClient } from '@neon/auth';

let clientPromise: Promise<VanillaBetterAuthClient | null> | undefined;
/** Fetch only public configuration. Auth URLs need no build-time VITE alias on Render. */
export function getManagedAuthClient() {
  clientPromise ||= (async () => {
    const response = await fetch('/api/config', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Cannot load authentication settings. Please try again.');
    const config = (await response.json()) as { neonAuthUrl?: string | null };
    return config.neonAuthUrl ? createAuthClient(config.neonAuthUrl) : null;
  })().catch((error) => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}
export async function getManagedAccessToken() {
  const client = await getManagedAuthClient();
  if (!client) return null;
  const session = await client.getSession();
  if (session.error) throw new Error(session.error.message || 'Cannot restore your Neon session.');
  if (!session.data?.user) return null;
  // The current SDK's exported client type omits plugin helpers; use its typed fetch.
  const result = await client.$fetch<{ token: string }>('/token');
  if (result.error || !result.data?.token)
    throw new Error(result.error?.message || 'Cannot authorize your Neon session.');
  return result.data.token;
}
