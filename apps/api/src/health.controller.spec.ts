import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('responde status ok (healthcheck do Railway)', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
