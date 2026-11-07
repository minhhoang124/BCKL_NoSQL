import type request from 'supertest';

// Derive the HTTP server type from Supertest's public API. Do not depend on
// internal paths that are not resolvable with NodeNext/package exports.
export type App = Parameters<typeof request>[0];
