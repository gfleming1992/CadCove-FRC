// Pure runtime contracts shared by the CLI and editor. No path or process startup side effects.
export function validateCustomSimulator(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(k => !['sourceDirectory','package','binary','features'].includes(k)) ||
      typeof config.sourceDirectory !== 'string' || !config.sourceDirectory.trim() ||
      typeof config.package !== 'string' || typeof config.binary !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.package ?? '') ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.binary ?? '') ||
      config.features !== undefined && (!Array.isArray(config.features) || config.features.some(f => typeof f !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(f)))) {
    throw Error('Invalid runtime.customSimulator: supply sourceDirectory, package, binary and optional features');
  }
  return config;
}

export function requireMechanismCapabilities(info, mechanisms) {
  if (mechanisms === undefined) return;
  if (!Array.isArray(mechanisms)) throw Error('world.mechanisms must be an array');
  if (!mechanisms.length) return;
  if (!Array.isArray(info.features) || !info.features.includes('custom-mechanisms-v1') ||
      !Array.isArray(info.mechanisms) || mechanisms.some(m => !m || typeof m.kind !== 'string' || !info.mechanisms.includes(m.kind))) {
    throw Error('Native simulator lacks the selected custom mechanism kinds. Build the matching custom simulator.');
  }
}

export function requireSolverScheduleCapability(info,world){
 const schedule=world.solver_schedule;
 if(schedule===undefined)return;
 if(!['per_refresh','per_tick'].includes(schedule))throw Error('Unknown solver schedule');
 if(schedule==='per_tick'&&!info.features?.includes('solver-schedule-v1'))throw Error('Native simulator lacks solver-schedule-v1; rebuild/update runtime before using per_tick scheduling');
}

// Reject unsupported numerical settings before an older native runtime silently
// ignores unknown JSON fields. All live and isolated sessions use this gate.
export function requirePhysicsNumericsCapabilities(info,world){
 requireSolverScheduleCapability(info,world);
 if(world.local_cylinder_contacts!==undefined){
  if(typeof world.local_cylinder_contacts!=='boolean')throw Error('local_cylinder_contacts must be boolean');
  if(world.local_cylinder_contacts&&!info.features?.includes('local-cylinder-contacts-v1'))throw Error('Native simulator lacks local-cylinder-contacts-v1; rebuild/update runtime before enabling local cylinder contact refresh');
 }
 if(world.max_contact_substeps!==undefined){
  if(!Number.isInteger(world.max_contact_substeps)||world.max_contact_substeps<1||world.max_contact_substeps>64)throw Error('max_contact_substeps must be an integer in 1..64');
  if(!info.features?.includes('contact-refresh-budget-v1'))throw Error('Native simulator lacks contact-refresh-budget-v1; rebuild/update runtime before limiting contact refreshes');
 }
}
