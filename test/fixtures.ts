/** A small diff: two hunks in greet.js and a renamed file. */
export const DIFF = [
  'diff --git a/greet.js b/greet.js',
  'index 1111111..2222222 100644',
  '--- a/greet.js',
  '+++ b/greet.js',
  '@@ -1,3 +1,4 @@',
  ' // greeting',
  '-export const greet = (name) => `Hello, ${name}`',
  '+export const greet = (name) => `HELLO, ${name}`',
  '+export const shout = true',
  ' export default greet',
  '@@ -10,2 +11,2 @@',
  ' a',
  '-b',
  '+c',
  'diff --git a/old.js b/new.js',
  'similarity index 90%',
  'rename from old.js',
  'rename to new.js',
  '--- a/old.js',
  '+++ b/new.js',
  '@@ -1 +1 @@',
  '-x',
  '+y',
  '',
].join('\n')

/** The change most review tests are about. */
export const CHANGE = { forge: 'github' as const, repo: 'me/app', number: 7, url: 'https://github.com/me/app/pull/7', ref: 'gh#7', title: 'Shout', author: { login: 'alice' }, labels: [] }
