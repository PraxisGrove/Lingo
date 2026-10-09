# Signed community rule subscriptions

Subscriptions are optional. Lingo includes local rules and user import/export;
no official distribution URL is preconfigured. The user decides which publisher
and public key to trust. A subscription contains selectors and translation
policies, never JavaScript or remote executable code.

## Reader setup

1. Obtain an HTTPS package address and base64 Ed25519 public key from a trusted
   publisher, ideally through an independently verified channel.
2. Enable community-rule updates in settings, enter both values under site
   rules, and select **Verify and update rules**.
3. A successful update saves the subscription and verified rules. Start a new
   page translation session to apply the rules. User rules keep higher priority.

Worker startup checks an existing subscription at most once per 24 hours. Manual
updates check immediately. Turning updates off prevents both automatic and manual
downloads while retaining the last verified rules for offline use. A different
subscription is saved only after a successful signature check.

Downloads omit cookies and referrers, reject redirects, time out after 10 seconds,
and accept at most 1 MiB. Invalid signatures, schema errors, oversized responses,
and network failures retain the last verified package. Rules are applied locally;
the download never includes webpage text or page URLs.

## Publisher workflow

Export a validated rule set from Lingo settings. Keep an Ed25519 private PEM key
outside this repository; never distribute or commit it. Sign the exported data:

```bash
node scripts/sign-rules.mjs exported-rules.json /secure/path/private-key.pem signed-rules.json
```

This writes the public package and `signed-rules.json.public-key.txt`. Publish the
package on HTTPS static hosting and share the public key through your trusted
publisher channel. The private key is read locally and is never included in the
package. Hosting and key rotation remain publisher responsibilities.

The signature covers the validated payload serialized with recursively sorted
object keys, original array order, and UTF-8 encoding. Domain names are normalized
to lowercase. A package has this structure:

```json
{
  "payload": { "schemaVersion": 1, "rules": [] },
  "signature": "base64 Ed25519 signature"
}
```

Subscribers currently accept any valid package signed by their configured key;
there is no monotonic version or rollback-prevention protocol. Use this for a
trusted publisher's declarative reading rules, not executable or security policy
distribution. Browsers must support Ed25519 Web Crypto verification.
