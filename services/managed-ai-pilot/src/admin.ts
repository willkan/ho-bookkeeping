import { loadConfig } from './config';
import { openDatabase } from './database';
import { PilotStore } from './store';

const [command, argument] = process.argv.slice(2);
const config = loadConfig();
const database = openDatabase(config.databasePath);
const store = new PilotStore(database, config);

try {
  if (command === 'issue-invite' && argument) {
    const issued = store.issueInvite(argument.trim());
    process.stdout.write(`${issued.inviteCode}\n`);
  } else if (command === 'revoke-invite' && argument) {
    store.revokeInvite(argument);
    process.stdout.write('revoked\n');
  } else {
    process.stderr.write('usage: admin issue-invite <recipient-label> | revoke-invite <code>\n');
    process.exitCode = 2;
  }
} finally {
  database.close();
}
