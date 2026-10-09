import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [rulesPath, privateKeyPath, outputPath] = process.argv.slice(2);
if (!rulesPath || !privateKeyPath || !outputPath) {
  throw new Error(
    'Usage: node scripts/sign-rules.mjs rules.json private-key.pem package.json',
  );
}
const payload = JSON.parse(await readFile(rulesPath, 'utf8'));
if (payload.schemaVersion !== 1 || !Array.isArray(payload.rules))
  throw new Error('Expected an exported Lingo rule set.');
// The client normalizes domain case before verifying a package.
for (const rule of payload.rules) rule.domain = rule.domain.toLowerCase();
const key = createPrivateKey(await readFile(privateKeyPath));
if (key.asymmetricKeyType !== 'ed25519')
  throw new Error('An Ed25519 private key is required.');
const signature = sign(null, Buffer.from(canonicalJson(payload)), key).toString(
  'base64',
);
await writeFile(
  outputPath,
  `${JSON.stringify({ payload, signature }, null, 2)}\n`,
);
const publicKey = createPublicKey(key).export({ format: 'jwk' });
await writeFile(
  `${outputPath}.public-key.txt`,
  `${Buffer.from(publicKey.x, 'base64url').toString('base64')}\n`,
);
process.stdout.write(
  `Signed package: ${outputPath}\nPublic key: ${outputPath}.public-key.txt\n`,
);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
