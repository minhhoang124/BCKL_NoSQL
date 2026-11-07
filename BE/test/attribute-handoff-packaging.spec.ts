import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const directory = path.resolve(process.cwd(), '../tools/attributes-qa');
describe('Portable Attributes QA init packaging', () => {
  it('sets the executable mode inside the Linux image rather than trusting host checkout mode', () => {
    const dockerfile = readFileSync(path.join(directory, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^FROM postgres:17$/m);
    expect(dockerfile).toMatch(/^COPY --chmod=0755 init-qa\.sh \/docker-entrypoint-initdb\.d\/10-attributes-qa\.sh$/m);
  });
  it('builds that image and does not bind-mount any init hook from the host', () => {
    const compose = readFileSync(path.join(directory, 'compose.yaml'), 'utf8');
    expect(compose).toMatch(/build:\s+context: \.\s+dockerfile: Dockerfile/);
    expect(compose).not.toContain('./init-qa.sh:');
    expect(compose).not.toContain('/docker-entrypoint-initdb.d');
    expect(compose).toContain("'127.0.0.1:5549:5432'");
    expect(compose).toContain('attributes-qa-data:/var/lib/postgresql/data');
  });
  it('keeps init bytes LF and does not reset/delete an existing database or role', () => {
    const source = readFileSync(path.join(directory, 'init-qa.sh'), 'utf8');
    expect(source).not.toContain('\r');
    expect(source).toMatch(/^#!\/usr\/bin\/env bash\n/);
    expect(source).not.toMatch(/DROP (DATABASE|ROLE)|TRUNCATE|rm\s+-/i);
    expect(source).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(source).toContain("PASSWORD :'qa_password'");
  });
});
