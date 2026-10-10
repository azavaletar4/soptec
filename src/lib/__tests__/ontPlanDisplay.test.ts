import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOntPlanName } from '../ontPlanDisplay';

const contractPlan = {
  name: 'Plan contratado',
  olt_tcont_profile: 'SMARTOLT-100M-UP',
  olt_traffic_profile: 'SMARTOLT-100M-DOWN',
};

test('prefiere el plan vinculado directamente a la ONT', () => {
  assert.equal(
    resolveOntPlanName({
      plans: { name: 'Plan de ONT' },
      tcont_profile: 'SMARTOLT-100M-UP',
      traffic_profile: 'SMARTOLT-100M-DOWN',
    }, contractPlan),
    'Plan de ONT',
  );
});

test('usa el plan del contrato cuando los perfiles OLT coinciden', () => {
  assert.equal(
    resolveOntPlanName({
      plans: null,
      tcont_profile: 'SMARTOLT-100M-UP',
      traffic_profile: 'SMARTOLT-100M-DOWN',
    }, contractPlan),
    'Plan contratado',
  );
});

test('no presenta el plan del contrato si los perfiles de la ONT difieren', () => {
  assert.equal(
    resolveOntPlanName({
      plans: null,
      tcont_profile: 'OTRO-UP',
      traffic_profile: 'SMARTOLT-100M-DOWN',
    }, contractPlan),
    null,
  );
});
