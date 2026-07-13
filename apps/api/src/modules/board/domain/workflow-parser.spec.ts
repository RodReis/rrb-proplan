import { parseWorkflow } from './workflow-parser';

describe('parseWorkflow', () => {
  it('extrai name, gatilhos e jobs', () => {
    const yaml = `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n  test:\n    runs-on: ubuntu-22.04\n`;
    const wf = parseWorkflow('.github/workflows/ci.yml', yaml)!;
    expect(wf.name).toBe('CI');
    expect(wf.triggers.sort()).toEqual(['pull_request', 'push']);
    expect(wf.jobs).toEqual([
      { name: 'build', runsOn: 'ubuntu-latest' },
      { name: 'test', runsOn: 'ubuntu-22.04' },
    ]);
  });

  it('name ausente → usa o nome do arquivo', () => {
    const wf = parseWorkflow('.github/workflows/deploy.yml', 'on: push\njobs: {}\n')!;
    expect(wf.name).toBe('deploy.yml');
  });

  it('YAML quebrado → null (não derruba a aba)', () => {
    expect(parseWorkflow('.github/workflows/x.yml', 'on: [: :')).toBeNull();
  });
});
