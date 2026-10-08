#!/usr/bin/env node
// Launcher used by bin/bootquest.cmd (and usable directly: node cli/bootquest.mjs <args>).
// `node --import tsx` resolves tsx from the CURRENT directory, which fails when the
// CLI runs inside a learner project; registering tsx from this file resolves it
// from the BootQuest repo's node_modules instead, whatever the cwd. No absolute
// paths: everything is relative to this file, so the repo can move.
import { register } from 'tsx/esm/api';

register();
await import('./src/main.ts');
