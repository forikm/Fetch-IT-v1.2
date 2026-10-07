// Changes only the password policy. Does not create users, send emails, change
// billing, enable services, or force existing users to replace their passwords.
const fs = require('node:fs');
const path = require('node:path');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const root = path.resolve(__dirname, '..');

async function main() {
  const mode = process.argv[2] || 'check';
  if (!['check', 'apply'].includes(mode)) throw new Error('Use check or apply.');
  process.loadEnvFile(path.join(root, '.env'));
  const app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) });
  const manager = getAuth(app).projectConfigManager();
  const before = await manager.getProjectConfig();
  const constraints = before.passwordPolicyConfig?.constraints || {};
  const desired = { enforcementState: 'ENFORCE', forceUpgradeOnSignin: false,
    constraints: { ...constraints, minLength: Math.max(15, constraints.minLength || 6), maxLength: Math.min(128, constraints.maxLength || 4096) } };
  if (desired.constraints.maxLength < desired.constraints.minLength) throw new Error('Existing password constraints need review.');
  if (mode === 'apply') {
    const backup = path.join(root, 'local-firebase-policy-before.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify({ savedAt: new Date().toISOString(), passwordPolicy: before.passwordPolicyConfig || null }, null, 2), { flag: 'wx', mode: 0o600 });
    await manager.updateProjectConfig({ passwordPolicyConfig: desired });
  }
  const after = mode === 'apply' ? await manager.getProjectConfig() : before;
  const policy = after.passwordPolicyConfig;
  const verified = policy?.enforcementState === 'ENFORCE' && policy.forceUpgradeOnSignin === false
    && policy.constraints?.minLength >= 15 && policy.constraints?.maxLength <= 128;
  console.log(JSON.stringify({ mode, policy: policy || null, verified, existingSigninsPreserved: policy?.forceUpgradeOnSignin === false }));
  if (mode === 'apply' && !verified) throw new Error('Password policy verification failed.');
}
main().catch(error => { console.error(JSON.stringify({ error: 'Firebase security operation failed. No service or billing upgrade was requested.', code: error.code || 'CONFIGURATION_ERROR', status: error.httpErrorCode?.status })); process.exitCode = 1; });
