export const DEMO_TENANT_ID = 'demo-hospital';

export function fixedDemoTenantId(value) {
  if (value != null && value !== '' && value !== DEMO_TENANT_ID) throw new Error('This demo only exposes its demo-hospital corpus.');
  return DEMO_TENANT_ID;
}

export function optionalVersion(value, name) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 80) throw new Error(`${name} must be a string of up to 80 characters.`);
  return value.trim();
}
